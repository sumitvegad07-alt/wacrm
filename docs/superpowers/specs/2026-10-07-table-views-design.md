# Saved Table Views — design

Date: 2026-10-07
Status: approved, building

## The problem

Two complaints, one root cause.

1. **Filters do not survive navigation.** Filter Leads, open a lead, come back — the filters
   are gone and have to be re-applied. Every list page keeps its filters in plain React state
   (`useState<FilterState>`), which React throws away when the page unmounts. The *columns* a
   user picks already survive, because `DataTable` writes those to `localStorage`. Filters were
   simply never saved. The same code shape exists on all 25 `DataTable` screens, so this is
   every module, not just Leads.

2. **No way to keep a working set.** A user who always looks at "my open high-value orders"
   has to rebuild that filter set by hand every single time. There is no concept of a named,
   reusable table arrangement.

## Prior art in this repo, and the lesson from it

`saved_reports` originally shipped as a multi-preset library with private/team/organization
sharing. On 2026-08-16 it was torn out and collapsed to one default view per user per module,
because (a) nothing in the UI could list or load a saved preset, (b) "Team" sharing had no RLS
policy behind it and silently behaved as Private, and (c) the "set as default" checkbox wrote
into a JSON blob nothing read.

So: multiple named views are fine, but every button in the UI must actually work, and sharing
either gets real RLS or does not exist. This design ships **no sharing** — views are private per
user — and ships the full list / apply / rename / set-default / update / delete set.

`saved_reports.user_id` also references `profiles(id)` while its RLS policies compare against
`auth.uid()`. Those are two different id spaces in this schema (`profiles.id` is its own uuid;
`profiles.user_id` is the auth id). The new table stores the **auth user id** and says so.

## Two layers of memory

Deliberately different, because the two complaints want different lifetimes.

| Layer | Where | Lifetime | Purpose |
|---|---|---|---|
| Scratch filters | `sessionStorage`, per browser tab | Until the browser tab closes | Fixes complaint 1. Navigate away and back, or refresh, and filters are still on. Zero network calls. |
| Column layout + rows per page | `localStorage` | Forever, per browser | Already existed; kept, including its storage format, so nobody loses a layout they set before this change. |
| Saved named views | `table_views` table in Postgres | Forever, per user, any device | Fixes complaint 2. Named, re-applicable, one can be the default. |

**Load order when a list opens**

1. Scratch filters for this tab, if the key is present (even if the value is `{}` — the user
   having cleared every filter is a real state and must not be overwritten).
2. Otherwise the user's default view for this table, if they have one.
3. Otherwise the module's built-in defaults (e.g. `record_status: ['active']`).

Closing the browser clears scratch, so the next session opens on the default view rather than on
a filter the user forgot they set a week ago. That is the behaviour asked for in both halves,
without filters silently haunting a table forever.

## Database

```sql
create table public.table_views (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id)   on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,  -- AUTH id, not profiles.id
  table_key   text not null,   -- normalised DataTable storage key, e.g. 'wacrm_leads_table_columns'
  name        text not null,
  config      jsonb not null,  -- { filters, columns: { active, visible }, pageSize }
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

- `unique (user_id, table_key, lower(name))` — no two views with the same name on one table.
- Partial unique index on `(user_id, table_key) where is_default` — at most one default per
  table per user, enforced by the database rather than by hope.
- RLS: one `for all` policy, `user_id = (select auth.uid())`, for both `using` and `with check`.
  The `select` wrapper matches the September RLS initplan performance work.
- `account_id` is carried for tenant hygiene (cascade on account delete, retention sweeps). It
  is not part of the RLS predicate — ownership is the auth user.

### `table_key` normalisation

Today's storage keys carry version suffixes (`wacrm_leads_table_columns_v2`,
`wacrm_contacts_table_columns_v3`) that developers bump to force-reset stored column layouts.
If views keyed off the raw string, a future bump would orphan every saved view. So `table_key`
is the storage key with a trailing `_v<digits>` stripped. Scratch and column `localStorage`
keys keep using the raw versioned string, so bumping still does its job of resetting layouts.

## Code shape

**`src/lib/table-views/` — pure helpers.** Config type, `normalizeTableKey`, scratch
read/write, `reconcileColumns`, `configsEqual`, `countActiveFilters`. No React, unit-testable.

**`src/hooks/use-table-view.ts` — one hook owns all of it.**

```ts
const tv = useTableView("wacrm_leads_table_columns_v2", { record_status: ["active"] });
```

Returns the filter state and setters the pages already use, plus column state, page size, and
the view operations (`applyView`, `saveAsView`, `updateActiveView`, `renameView`, `deleteView`,
`setDefaultView`), plus `isDirty` and `activeFilterCount`.

The hook reacts to a changing key, which two screens need: Deals keys by selected pipeline, and
Attendance keys by tab. Attendance's manual `setFilterState({})` on tab change goes away — a
key change already gives each tab its own remembered filters.

**`src/components/ui/data-table/table-views-bar.tsx`** — the Views dropdown plus the
"N filters active · Clear" chip, rendered in the existing grey toolbar above the table.

**`DataTable` changes.** It stops owning column state. The two `useState`s and the
`localStorage` effect move into the hook; `DataTable` derives the effective ordered columns by
running `reconcileColumns(columns, tv.columnState)` on each render, which is a pure function, so
a view switch needs no effect and cannot flicker. `storageKey` becomes optional and is taken
from `tableView` when that is supplied. Reconciliation keeps today's behaviour that a column
added by a later release shows up inside an older stored layout if its `visibleByDefault` is not
`false` — and it no longer silently writes that back to storage.

Current page number stays local to `DataTable` and is not part of a view; snapping back to
page 1 on a filter change is correct.

## UI

In the grey bar above every table, left side, next to `Total: 412 records`:

```
[ My Hot Leads ▾ ]   3 filters active · Clear
```

Dropdown:

- **All records** — module defaults, no view active
- the saved views; a star marks the default, a tick marks the active one
- `• Modified` beside the active view when the current arrangement differs from it
- separator
- **Save as new view…** (name prompt) · **Update "<name>"** (only when modified) ·
  **Rename** · **Set as default** / **Remove as default** · **Delete**

## Error handling

Views are a convenience and must never block a table. All database failures surface as a toast
and leave the table working from local state. If the views fetch fails, the dropdown shows only
"All records". Scratch and column storage are wrapped in try/catch because `sessionStorage` and
`localStorage` both throw in some privacy modes.

## Testing

Vitest, against the pure helpers and the hook:

- a filter change writes scratch; a remount restores it
- a cleared-to-empty filter set is restored as empty, not replaced by module defaults
- a default view applies when there is no scratch, and does not when there is
- `isDirty` is false right after applying a view and true after one filter change
- `reconcileColumns` surfaces a newly added column inside an older stored layout, and respects
  `visibleByDefault: false`
- `normalizeTableKey` strips `_v2` / `_v3` and leaves other names alone

## Scope

In: all 25 `DataTable` screens on web, every tenant, one migration applied to production.

Out: the Android app (its lists are built separately; it would need the same hook ported and an
APK build). Out: deep-linking filters into the URL — it does not fix the reported problem, since
navigating by the sidebar menu discards the URL anyway. Out: sharing views with the team.

# Table filter row, per-visit filters and complete Manage Column — design

**Date:** 2026-10-16
**Status:** awaiting review
**Scope:** web only. The Android app shows cards, not column tables, so a
filter row does not apply there and no APK is needed.

## Why

Four requests, all about the list tables:

1. Filters live behind a popover on the column heading. They should sit in a
   permanent row above the data, showing the applied value as a chip, like the
   competitor's screen.
2. A column backed by a list of values should offer that list in its filter,
   not a free-text box.
3. Manage Column is missing fields that exist on the record.
4. All of it, on every module.

Plus one behaviour change: an ad-hoc filter should last only as long as you
stay on that screen. Leave the screen and it resets. This reverses the
"filters survive navigation" behaviour shipped on 12 Oct. Saved **Views** are
unaffected and remain the way to keep a filter permanently, so the rule becomes
*quick filters are temporary, Views are permanent*.

## What is already in place

Worth stating, because it keeps this job much smaller than it looks:

- Filtering already runs **on the database**, not in the browser, through
  `src/lib/table/apply-filters.ts` and `useServerTable`. Filter values flow
  through `tableView.filterState` either way. The filter row is therefore a
  presentation change and does not touch query building.
- `ColumnDef.type` already distinguishes `text` / `select` / `date`, and
  `ColumnDef.options` already carries a value list for `select`.
- Custom-field filtering already works (`applyCustomFieldFilters`).
- `custom_fields` rows already carry `is_filterable`, `show_in_table`,
  `is_sortable` per field, per module, per account.

## Part A — the filter row

Replace the popover-on-the-heading with a second row rendered directly under
the header row, always visible.

Per cell, by `ColumnDef.type`:

| type | control | applied state |
|---|---|---|
| `text` | input with a magnifier icon, placeholder = column label, debounced | the typed text stays in the box, with an `×` to clear |
| `select` | a button that opens a searchable value list (Part C) | chip showing the chosen value, or "3 selected", with an `×` |
| `date` | a button opening the existing preset list and custom range | chip showing the preset name, with an `×` |
| no type | empty cell | — |

- A column whose predefined field has `is_filterable === false` renders an
  empty cell, so Field Settings still controls filterability. When no
  `custom_fields` row exists for that column — which is the normal state for an
  account that has never opened that module's form builder — the column stays
  filterable. Absence must never mean "off".
- The header row keeps the column label, the sort control and nothing else.
- `DataTableHeader` loses its filter responsibility and becomes a plain
  sortable heading. The popover bodies move, almost unchanged, into the new
  `DataTableFilterRow`.
- The leading selection and pinned Action columns render empty filter cells so
  the row stays aligned.
- On phones the filter row scrolls horizontally with the table, same as the
  header. Controls keep the 44px tap-target rule already used in the header.

**Files:** new `src/components/ui/data-table/data-table-filter-row.tsx`;
`data-table.tsx` renders it; `data-table-header.tsx` is reduced.

## Part B — filters last for one visit

Today `useTableView` keeps filters in `sessionStorage`, so they survive both a
refresh and navigating away and back. The wanted behaviour is: a refresh keeps
them, switching to another browser tab keeps them, moving to a different screen
inside the app clears them.

Those cases cannot be told apart by storage key or pathname alone — navigating
away and back lands on the same pathname. So track navigation:

- A small client component in the dashboard layout watches `usePathname()` and,
  on every change, increments a `navSeq` counter in `sessionStorage`.
- `writeScratchFilters` stores the current `navSeq` alongside the filters.
- `readScratchFilters` restores only when the stored `navSeq` equals the
  current one, and clears the entry otherwise.

Which gives:

| action | navSeq | result |
|---|---|---|
| refresh on the same screen | unchanged | filters kept |
| switch to another browser tab and back | unchanged | filters kept |
| go to another screen and come back | incremented twice | filters cleared |
| change pipeline on Deals (same route, new storage key) | unchanged | filters kept |

Column layout, rows-per-page and saved Views keep their current persistence —
they are preferences, not filters.

**Files:** `src/lib/table-views/index.ts` (the two scratch functions), a new
nav-counter component mounted in the dashboard layout.

## Part C — where dropdown values come from

Mixed strategy, chosen for speed:

1. **Columns already carrying `options`** — Lead Status, Source, Industry,
   Record Status, Category, Role and similar — keep using them. No change, no
   request.
2. **People columns** — Owner, Collaborators, Assignee, Created By — read the
   account's staff list, which is small and already fetched on most screens.
   A shared `useAccountPeopleOptions()` hook fetches it once and caches it for
   the session.
3. **Everything else that has no list behind it** — City, Area, Company and
   similar free-text columns — call a new endpoint that returns the distinct
   values present in that column, for that account, capped.

For (3): `GET /api/table/column-values?module=<m>&column=<c>&q=<search>`.

- Server route under the normal tenant auth, querying through the **caller's**
  client so RLS applies. No service role.
- `module` and `column` are looked up in a hard-coded allowlist that maps them
  to a real table and column. An unknown pair is a 400. The allowlist is the
  security boundary — no caller-supplied table or column reaches SQL.
- Returns at most 100 values, ordered by frequency then alphabetically, with a
  `truncated` flag. The `q` parameter filters server-side so a long tail is
  still reachable by typing.
- The dropdown shows a search box whenever `truncated` is true.

The list is fetched when the dropdown is first opened, not on page load, so a
screen pays nothing for filters nobody uses.

## Part D — Manage Column completeness

Two separate causes, both real.

**Cause 1 — columns are stripped before Manage Column sees them.**
`getVisibleTableColumns()` (`src/lib/custom-fields.ts:367`) *removes* a base
column when its predefined field has `show_in_table === false`. The removed
column never reaches `ManageColumnsDialog`, so it cannot be switched back on
from there. In the founder's account this hides, among others, Leads →
area, pincode, whatsapp, address, city, state, country, and Customers →
address, area, state, whatsapp, country, pincode. Thirty-two fields across
ten modules are in this state.

Fix: `show_in_table === false` should mean **hidden by default but listed in
Manage Column** — set `visibleByDefault: false` and keep the column. Only
`is_active === false`, meaning the field was switched off in Field Settings,
should remove it entirely. That matches what the two flags mean everywhere
else.

This changes `getVisibleTableColumns` to return the full set plus a default
visibility, and `DataTable` to feed the full set to the dialog while
`reconcileColumns` decides what renders. `reconcileColumns` already honours
`visibleByDefault`, so the dialog needs no change.

**Cause 2 — fields genuinely missing from the column list.**
Some screens' `ColumnDef` arrays simply never defined a column for a field
that exists on the record. This needs a per-screen pass: for each of the 26
screens, list the stored columns of its table and its module's custom fields,
and add a `ColumnDef` for every one that is missing, with
`visibleByDefault: false` so nothing on screen changes until the user asks.

Sensitive and structural columns stay out: ids, foreign keys, `account_id`,
`user_id`, audit timestamps other than created/updated, and the `user` module's
`password` / `repassword` fields.

## Rollout

1. **Leads and Customers first.** Parts A, B, C and D on those two screens
   only, pushed to live for review.
2. **The remaining 24 screens** once the first two are approved, including the
   per-screen Manage Column pass from Part D cause 2.

## Testing

- Unit: the `navSeq` restore rule (all four rows of the Part B table); the
  allowlist rejecting unknown module/column pairs; `getVisibleTableColumns`
  keeping a `show_in_table: false` column but marking it hidden, and still
  dropping an `is_active: false` one.
- Manual on live, per screen: filter row renders aligned with the header; a
  chip appears and clears; a dropdown lists real values and searches; leaving
  and returning clears the filter; refresh keeps it; a saved View still applies
  its filters; every field appears in Manage Column.
- Must be checked on an account with **no `custom_fields` rows at all** —
  three tenants are in that state, because predefined fields are seeded lazily
  on first use of a form builder.

## Risks

- The filter row adds a second row to every table on every screen. On small
  laptops that is real vertical space. Mitigation: the row is compact
  (28px) and uses the same density tokens as the header.
- Part D cause 1 changes what Manage Column lists for every existing tenant.
  Nothing becomes visible that was not visible before — the columns arrive
  hidden — but the dialog gets longer.
- The distinct-values scan is the only new database load. It is capped,
  lazy and account-scoped, but it is worth watching on the largest tables
  after rollout.

## Open question, not blocking

Which screen were you on when you found phone number missing from Manage
Column? Cause 1 above explains WhatsApp Number on Customers and Leads, but
`phone` itself is set to show on both. If it was a different screen, that is a
cause 2 case and the per-screen pass will catch it either way.

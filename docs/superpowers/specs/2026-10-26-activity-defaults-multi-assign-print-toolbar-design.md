# My Activity defaults, multi-user tasks, print everywhere, and the lost toolbar line

**Date:** 2026-10-26
**Status:** Approved design, not yet built
**Scope:** `wacrm-web` (all items), `wacrm-mobile` (item 3 only), one Supabase migration

Five requests from the founder, answered as one batch because three of them
touch the same table component.

---

## 1. My Activity opens on today

**Today:** `/follow-ups` (labelled "My Activity" in the sidebar) opens with
Period = `All` and Assign-to = `all`. A rep with four hundred tasks behind them
sees all four hundred.

**Wanted:** Period defaults to `Today`.

### Design

`src/app/(dashboard)/follow-ups/page.tsx` holds both filters in local state.
Change `useState("All")` to `useState("Today")` for `period`.

Two things make this more than a one-word edit:

**Tasks with no due date disappear.** The period filter already reads
`if (!task.due_date) return false` — every period other than `All` drops them.
Today that is harmless because the page opens on `All`. Once it opens on
`Today`, an undated task is invisible on the screen named after it. A task
with no due date is not a future task, it is an unscheduled one, and it should
be worked on.

So `Today` means **due today or not dated at all**. Only the `Today` default
gets this treatment; picking `Tomorrow` or `This Week` by hand keeps today's
strict behaviour, because there the user has named a date range on purpose.

**There is no "Clear filters" on this page.** Checked: `/follow-ups` has no
reset control, so nothing can strand the user on a filter combination the page
never opens with. If one is ever added it returns to `Today` + own-user, not to
`All` — a reset that lands somewhere the page never opens is a bug.

### Out of scope, but noted

Period filtering runs in the browser on `new Date(task.due_date)`, which is
browser-local, not account-local. This contradicts the house rule that dates
are account-local. It is wrong by up to a day for a user whose device clock
sits in another timezone. It is wrong today and this change does not make it
worse, so it is recorded here and left alone.

---

## 2. My Activity opens on my own tasks

**Today:** Assign-to defaults to `all`.

**Wanted:** every user, admins included, opens on tasks assigned to
themselves. Anyone can still switch to a colleague or to All.

### Design

The page already loads the profile list into `profiles`. It needs one more
thing: the signed-in user's own `profiles.id`.

Note the id space. `tasks.assigned_user_id` is a **`profiles.id`**, not an
auth user id. These differ in this database and mixing them is a recurring
source of empty screens. Resolve the signed-in auth user to their
`profiles.id` and filter on that.

**The first fetch must wait.** `fetchTasks` currently fires on `accountId`
alone. If it fires before the profile resolves, `assignTo` is still `"all"`
and the page flashes the whole team's tasks before snapping to one person.
Gate the first fetch on the profile being known.

A user with no profile row (should not happen, but does) falls back to `all`
rather than showing an empty page with no explanation.

---

## 3. A task can be assigned to several people

**Today:** `tasks.assigned_user_id` is a single nullable `profiles.id`.

**Wanted:** many people on one task, and — the founder's explicit choice —
**each person marks their own completion**. The task is not finished until
everyone has finished it.

### Why this is the largest item

`tasks.assigned_user_id` is read by far more than the task screen:

| Reader | Where |
|---|---|
| Notification triggers | `20260918120000_notifications_foundation.sql` — insert and update triggers |
| Notification pipeline | `20260918160000_*`, `20260919120000_*` — resolves the task's assignee |
| Report engine | `20260818160000_task_report_module.sql` — the `assignee` join and the "my tasks" filter |
| Import engine | `20260823100000_*`, `20260823140000_*` — `import_commit` writes it |
| Mobile app | ~10 call sites in `wacrm-mobile` |
| Web | ~22 call sites |

An APK already in reps' hands reads that column, and the founder batches EAS
builds, so there is no moment when every client is new. **The column must keep
working.**

### Data model

New table:

```
task_assignees
  id           uuid pk
  task_id      uuid not null references tasks(id) on delete cascade
  profile_id   uuid not null references profiles(id) on delete cascade
  status       text not null default 'Pending'   -- 'Pending' | 'Completed'
  completed_at timestamptz
  created_at   timestamptz default now()
  unique (task_id, profile_id)
```

Indexed on `task_id` and on `profile_id`.

`tasks.assigned_user_id` **stays**, holding the first assignee, maintained by
trigger. Everything in the table above keeps reading it and keeps working. The
old APK shows the first assignee and can complete the task — degraded, not
broken.

### Rollup rule

A trigger on `task_assignees` writes back to `tasks`:

- `tasks.status` becomes `Completed` only when **every** assignee row is
  `Completed`.
- If a row goes back to `Pending`, or a new assignee is added to a completed
  task, `tasks.status` drops back out of `Completed`.
- `tasks.assigned_user_id` is kept pointing at the oldest remaining assignee
  row. If the last assignee is removed it becomes `null`, as today.

Status values follow the existing `tasks.status` CHECK
(`Pending | In Progress | Waiting | Completed | Cancelled`). Assignee rows use
only `Pending` and `Completed`; per-person "In Progress" is not wanted and is
not built.

### Backfill

One `task_assignees` row for every existing task that has an
`assigned_user_id`, with `status` derived from the task's own status
(`Completed` if the task is completed, else `Pending`). Tasks with no assignee
get no row. After backfill every existing task behaves exactly as before.

### RLS

`task_assignees` is reachable only through its task: a row is visible when the
parent task is visible. No new account scoping of its own, so it cannot drift
from the task's own policy. Follow the house pattern and wrap `auth.uid()` in
a scalar subquery so the policy does not re-run per row.

### Web behaviour

- **Task form** — "Assigned To" becomes a multi-select. Assignment stays
  optional, exactly as today: a task may have nobody on it, one person, or
  several. A task with nobody on it keeps whatever status it is given by hand,
  since there is no one to roll up from.
- **Task list / My Activity** — shows the first assignee plus a count
  ("Priya +2"). The status column shows **your own** row's status when you are
  an assignee, and the rolled-up task status when you are not.
- **Completing** — ticking Done on My Activity completes **your** row only.
  The screen reports progress ("2 of 3 done") so it is obvious the task lives on.
- **Assign-to filter** — matches a task when the chosen person is **any** of
  its assignees, not just the first.

### Mobile behaviour

Same read-and-complete-own-row rules. Code is written and pushed; **no EAS
build and no `eas update` is triggered** — the founder batches those.

### Report engine

The Task report's `assignee` dimension currently joins
`profiles ON base.assigned_user_id = u.id`. It changes to join through
`task_assignees`.

**This changes numbers the founder has seen.** Grouped by assignee, a task with
three people becomes three rows instead of one. That is the correct answer to
"how many tasks does Priya have", but it will not match last month's export.
Flagged to the founder and accepted.

The report's "my tasks" filter likewise matches any assignee.

### Notifications

The assign notification fires for **every** assignee, not just the first. The
existing triggers watch `tasks.assigned_user_id`; a new trigger on
`task_assignees` covers the rest. Care is needed not to notify the first
assignee twice when both fire.

### Import engine

`import_commit` keeps writing `assigned_user_id` and additionally writes the
matching `task_assignees` row, so an imported task is consistent. Multi-assignee
import from a spreadsheet is **not** in scope.

---

## 4. Print on transaction modules and reports

**Today:**

- Document print exists for Order, Quotation, Dispatch, Payment, Invoice and
  Proposal under `src/app/print/*`. All are hard-coded `@page { size: A4 }`.
- Payment has a print page but **no button anywhere in the tenant app** — only
  the superadmin side reaches it.
- Reports already print at A4 **and A5** through `/print/report?size=`, driven
  by `report-viewer.tsx`. This half is done.
- Lists cannot be printed at all; they export to CSV.

**Wanted:** print for transaction modules, in A4 and A5, for both a single
record and the list on screen; list print on every table; reports keep theirs.

### Paper size

`/print/report` already solves this well: read `?size=`, set
`@page { size: ... }`, and step every font and padding down one notch for A5
because A5 is half a sheet. That approach is lifted into a small shared helper
rather than reinvented per page, and the existing report page is refactored
onto it so there is one implementation, not two.

### Document print

- A5 added to the six existing print pages via the shared helper.
- The missing **Payment receipt button** is added to the tenant payment detail
  screen.
- New document print pages for **Expense** and **Leave**.
- Each print entry point becomes a small A4 / A5 menu instead of a bare button.

### List print

One new route, `/print/list`.

It reuses what the table already has. `DataTable` holds `visibleColumns` and,
for server-paged screens, `serverPagination.exportAll()` — which already
fetches every row matching the current search and filters, capped at
`EXPORT_MAX_ROWS`, for CSV. List print renders those same rows and those same
columns onto paper. Nothing per-screen has to be written.

Two consequences, both deliberate:

- The printed list matches **what you are looking at** — your filters, your
  column choices, your sort — not a fixed report layout.
- A server-paged screen that does **not** pass `exportAll` has no Export button
  today and gets **no print-list entry either**, for the same reason: it could
  only print the twenty rows on screen, which is never what is meant. This is
  consistent with existing behaviour rather than a new limitation.

Client-paged screens hold all their rows already and always qualify.

The entry points are "Print list (A4)" and "Print list (A5)" in each table's
hamburger menu, next to Export CSV.

### Reports

Already built. The work here is **verification, not construction**: confirm A4
and A5 both render correctly across the ten engine reports and the two summary
reports, and fix what is broken. No rebuild.

---

## 5. The toolbar line goes

**Today:** every `DataTable` renders a strip above the grid holding four
things — the search box, the saved-views dropdown ("All records"), the record
count, and a hamburger with Export CSV and Manage Column. Nine screens also
push their own buttons into it through the table's `actions` prop
(Categories, Units, Customers, Expenses, Leads, Leaves, Products, Stock,
Roles).

**Wanted:** that line gone from all modules. The column filter row below it now
covers searching, so the strip costs vertical space without earning it.

**Decided:** the tools survive, the line does not. Views, record count and the
hamburger move up into the page heading row beside the existing page buttons.
The global search box is removed outright.

### Design

29 files render a `<DataTable>`. Rewiring each by hand to pass its toolbar up
to its `PageHeader` would be slow, would be got wrong somewhere, and would
leave the two components able to drift apart.

Instead the two components are connected directly:

- A small context provider sits in the dashboard layout, holding the slot's
  DOM node and a flag for whether any table wants it.
- `PageHeader` renders a container into that slot, in its existing right-hand
  actions area, so table controls land beside "Create Order" rather than
  replacing it.
- `DataTable` renders its views dropdown, record count, hamburger **and its
  `actions` buttons** into that container through a React portal.

**No page files change.** The line disappears everywhere at once.

**Watch for doubled buttons.** Several of those nine screens pass buttons to
*both* their `PageHeader` and their table — Customers and Expenses among them.
Once both land in the same row, a near-duplicate pair may appear side by side.
Each of the nine is checked by eye during the build and the redundant one
dropped; this is the only part of item 5 that needs per-page attention.

**The trap.** `PageHeader` returns `null` when it has no breadcrumbs, no badge
and no actions. On a page like that, a portal with nowhere to go would silently
lose the table's controls — the same failure mode as the settings panels whose
descriptions never rendered because their head component returned null. So:
`PageHeader` must also render when a table has registered for the slot, and
`DataTable` must fall back to rendering its controls in place when no slot
exists. Neither path may end with the controls nowhere.

### What is lost

The global search box, on every table. Accepted by the founder on the grounds
that each column now has its own filter. Screens whose search covers fields not
shown as columns are worth a look during the build; if one is found, it is
raised rather than silently kept.

**My Activity is not affected.** `/follow-ups` is a hand-built page, not a
`DataTable`, so it has no toolbar line to remove and keeps its own search box.
Items 1 and 2 are its whole share of this batch.

---

## Build order

1. Items 1, 2 and 5 — small, independent, immediately visible.
2. Item 4 — print. The shared paper-size helper first, then documents, then
   list print, then report verification.
3. Item 3 — multi-assignee. Largest, needs a migration applied by hand on the
   Mumbai database, and needs mobile code pushed without a build.

## Verification

Item 3's migration must be run by the founder on Mumbai — the MCP connection
cannot apply DDL there. Nothing is reported as done until it is pushed to
`main` and deployed, with the commit hash given.

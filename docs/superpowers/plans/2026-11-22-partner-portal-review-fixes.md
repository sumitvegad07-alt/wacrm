# Partner Portal — the founder's review of Leads, Customers and My Activity

**Date:** 2026-11-22
**Status:** built
**Brief, in his words:** *"For the partner portal i told you to make it exact copy of our existing CRM including leads, customer, my activity, but it is not the exact copy… Find the issues around UI & UX, database level, coding level, generate multiple test scenarios than do the testing, find bugs, solve them, Restart testing… There are some more plenty of problems which you need to find out."*

**Repos:** app is `C:\Wacrm\ozzo-partner`; migrations and DB scenarios are in `C:\Wacrm\wacrm-web`.

---

## Why it was not a copy: the root cause

Not a list of missed details. The portal was built with **its own layout
vocabulary** rather than the CRM's.

The CRM composes every record page from four shared primitives —
`DetailPageLayout` > `DetailSection` > `DetailGrid` > `DetailItem` — and every
form from `FormGrid` / `FormField` / `FormActions`. Those eight components,
plus `Textarea`, `MultiSelect`, `CollaboratorsSelect` and `LineItemsTable`,
were **never ported**. `components/shared/` in the portal held nine files
against the CRM's twenty-three.

So each portal screen hand-rolled its own container, printed the record's name
at `text-base` inside the compact header strip instead of as an `h1` with a
back arrow and a meta line, and laid its fields out in one flat `<dl>` instead
of card-framed sections of label/value pairs. The screens were not *missing*
parity with the CRM; they had no way to express it.

`app/design-system-parity.test.ts` passed throughout, because it compares
tokens — colours, spacing, type scale — and every token was right. The
components the tokens are meant to be used *through* were simply absent.

---

## His ten points

| # | His words | What it was | What was done |
|---|---|---|---|
| 1 | View page of lead and customers are not exact copy | No `DetailPageLayout`, no sections, record name at `text-base`, flat `<dl>` | Four primitives ported; both pages rebuilt on them, with the CRM's h1 + back arrow + badges + meta line, its inline-editable band and its two-column body |
| 2 | On My Activity no button to click search | No Apply button; four differently-named controls (Whose / When / Kind / Priority); Status was a segmented strip | The CRM's six controls in its order and its words — Search, Users, Type, Period, Status, Priority — and its **Apply** button. Search is held 400ms rather than firing per keystroke |
| 3 | No task creation option on leads, customer | The record Timeline was the changelog only; its own comment said activities would join it "in Phase 2B" | `RecordTimeline`: the CRM's Planned / Past split, its filter, and an **ADD** button that opens the same ActivityForm with the record already linked and the link hidden |
| 4 | Task creation from My Activity is totally different | `<input type="time">`, a column of tick-boxes for assignees, SearchableSelect for priority, raw `<textarea>` for a note, no Delete, "Add"/"Save" | The CRM's TaskForm field for field: 5-minute 12-hour time list, `MultiSelect` assignees, house `Select` priority, `Textarea` note, Delete in the footer, "Create Task" / "Create Note" / "Save Changes" |
| 5 | Converted lead should leave the Leads list | `partner_convert_lead_to_customer` never touched `record_status` | Migration `20261125120000`: the lead is retired, its open activities MOVE to the customer, its timeline is copied across, and the whole thing can no longer half-succeed (see below) |
| 6 | Lead collaborator and customer assignment not available | Both were on the create forms and read-only text afterwards | The CRM's inline band on both detail pages — Owner, Status (leads), Collaborators — auto-saving on change. New right `assign_customers`, since the route gated customer reassignment on `assign_leads` |
| 7 | Loading issues all over, everything took too long | 5–6 sequential Mumbai round trips before any HTML; no loading boundaries anywhere; a second client-side wave after mount | `getPartnerMe()` wrapped in React `cache()`; middleware no longer authenticates `/api` and `_next`; 16 `loading.tsx` files; both detail pages fetch everything in ONE server-side `Promise.all` |
| 8 | Customer creation has no plan dropdown | Free-text boxes for plan and billing term | `lib/plans/catalog.ts` ported from the CRM; both are searchable dropdowns that keep whatever a legacy customer already holds |
| 9 | Settings must have area/territory creation | No territory concept at all; the address pickers offered "what anybody has typed before" | Migration `20261126120000`: `partner_territories` (Country > State > City > Area), a Settings panel, and a **Copy from OZZO CRM** button that brings his existing tree across in one `INSERT … SELECT` per level. The four address pickers now cascade down it, falling back to the old lists while it is empty |
| 10 | Plenty more to find | — | See below |

---

## What #10 turned up

### A horizontal privilege escalation, in every write route

Every route checked a RIGHT and then wrote with the **service-role key**,
which ignores RLS. A right is not a row: `edit_leads` says "may edit leads",
not "may edit THAT lead". `PATCH /api/leads { id: <another team's lead> }`
was accepted. Same for customers and activities, and
`/api/activity/complete` had it on a right as weak as `view_activities` —
anybody could tick or untick anybody's activity, and its second branch writes
`partner_tasks.status` directly, so the damage was not even limited to one
person's copy.

`lib/auth/visible-row.ts` now reads the row on the caller's **own** session
before the service client is built, so the answer comes from the policy
itself rather than from a second copy of the scoping rule in TypeScript.

`GET /api/customers/billing?account_id=…` had the same shape: it served any
tenant's invoices and subscription to any partner employee holding
`view_invoices`. The account id now has to belong to a customer in the
caller's own scope.

### A conversion that could half-succeed in silence

`partner_convert_lead_to_customer` is SECURITY INVOKER, so its
`UPDATE partner_leads` was filtered by `partner_leads_update`, which requires
`edit_leads`. A role with `convert_leads` and **not** `edit_leads` — one tick
apart on the Roles screen — created the customer, updated nothing, and
returned success. A customer with no lead marked converted, a lead that could
be converted again tomorrow, nothing raised and nothing logged. Scenario
`V6`/`V6b` in `85_partner_convert_and_territories.sql`.

### Two timeline writers that overlapped

The route logged `Updated: owner_id` while the detail screen logged
`Owner changed to Priya.` for the same request — two entries, one of them a
column list. The route owns it now and writes
`Owner: Priya Shah → Rahul Mehta` from the before values it already reads for
the scope check (`lib/timeline/describe.ts`). A save that changed nothing
records nothing.

### An activity with nobody on it was invisible to its author

My Activity resolves "whose" through `partner_task_assignees`. An unassigned
activity has no row there, so it appeared under "All Users" and nowhere else —
including for the person who created it, whom `partner_tasks_select` shows it
to through its `created_by` arm. Fixed, and new activities now default to the
creator, as the CRM's TaskForm does.

### Smaller things

- **No toasts.** `sonner` was a dependency and the `Toaster` was never
  mounted, so a successful save was silent — which reads as nothing having
  happened, and gets clicked again.
- **No `error.tsx`, no `not-found.tsx`.** A thrown error showed Next's grey
  "Application error" page: no menu, no way back. 404 is where every
  `notFound()` in the portal lands, which is how it refuses a record you may
  not see.
- **`npm run lint` had never worked** — `"lint": "eslint"` with no config
  file, so one of the five gates exited with "couldn't find
  eslint.config.js". It runs now: 0 errors.
- **A pinned Action column** on the Leads and Customers tables, as every CRM
  table has. `RowActions` had been ported with the table framework and had no
  caller at all; `setRecordStatus` in `leads-client` was written and then left
  unreachable.
- **`window.confirm` for converting a lead**, whose own comment said it was
  "deliberately and for now" because no confirm component was mounted.
  `ConfirmDialog` has been there since Phase 2B.
- **A finished note appeared twice** in the Past list — once as a note, once
  as a done task. The CRM has this too; it was left behind rather than copied.
- **The per-person tick.** `RecordTimeline` compared `status === "Completed"`,
  which on a shared activity would untick it for everybody.

---

## Deliberately NOT done

- **The CRM's Tasks table** (the reporting view, with its filter row and
  Manage Column). The CRM has both screens; the spec maps his module to My
  Activity only.
- **Task comments, checklists and attachments** — three more tables, and in
  the CRM they live on the task *detail* page, which this portal has no route
  for.
- **Custom fields** on leads and customers. The CRM's detail pages render a
  tenant's own configured fields; the portal is one organisation and has no
  `custom_fields` equivalent. Its "Other Details" section shows notes.
- **Deals.** The CRM's lead page carries a Deal Details table. There is no
  deals module here.
- **Retroactively retiring leads converted before today.** The paste doc
  carries the one-line `UPDATE` to run if he wants it. A migration that moved
  live records out of somebody's working list without being asked is the kind
  of surprise the working agreement exists to prevent.

---

## Gates

- `npx tsc --noEmit` — clean
- `npx vitest run` — 325 passed / 33 files (up from 264 / 28)
- `npx next build` — clean, 29 routes
- `npx eslint .` — 0 errors (40 warnings, all React 19 compiler opinions on
  the pre-existing fetch-in-effect pattern, held at `warn` and documented in
  `eslint.config.mjs`)
- `bash scripts/run-db-tests.sh` — see the run log; scenario file
  `85_partner_convert_and_territories.sql`, 24 assertions
- **Clicked through:** the app boots and `/login` renders with the Toaster
  mounted. The signed-in screens were NOT clicked — `.env.local` points at
  production Mumbai and the portal needs a real partner login, which is his
  to type, not mine.

### What the harness caught, in the migration

`SELECT ... FOR UPDATE` is **not a read** as far as RLS is concerned. The
first draft of the convert function copied the CRM's `FOR UPDATE`, to stop two
clicks a second apart both passing the already-converted guard. Postgres
applies the UPDATE policy's USING clause to a locking select as well as the
SELECT policy, because the row is being claimed as an update target — and
`partner_leads_update` requires `edit_leads`. So one word re-introduced
exactly the coupling the migration exists to remove, and scenario V6 failed
with *"That lead does not exist, or you cannot see it."* It read like a policy
bug.

The lock is gone. A partial unique index on
`partner_customers.source_lead_id` does the job instead, and covers the case
the lock never did — two callers in two different sessions. Scenario V9.

### What the harness caught, in my own test file

The first run reported three failures that looked like migration bugs and
were not: `SET LOCAL ROLE` lasts only for the transaction it is in, and psql
runs each statement in its own, so those scenarios ran as `postgres` — which
bypasses RLS and has no `test.uid`. T7 reported that a Sales Executive could
add a territory (nothing was enforcing the policy) and T8 that a Super Admin
could not copy the tree (there was no caller to look up). The convention is
`SET ROLE` plus `set_config('test.uid', …, false)`, as every other partner
test file uses. Written down at the top of file 85.

---

## The SQL he has to paste

`docs/RUN-THIS-SQL-partner-review-fixes.md` — one block, idempotent, safe to
run even if the My Activity block from `RUN-THIS-SQL-partner-activity.md` has
already been run. Until it is:

- My Activity shows an error (its tables do not exist),
- converting a lead still leaves it in the Leads list,
- Settings → Territories says territories are not set up yet, and the address
  pickers keep their old behaviour.

Everything else in this build works without it.

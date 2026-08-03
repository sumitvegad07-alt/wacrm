# Route Management — Phase 2b UX Review

**Status:** For CTO review (required before Planner / Phase 2c begins)
**Date:** 2026-08-03
**Commits:** `32f5ce2` (List + Wizard), `147f7f1` (Detail/Workspace). Branch `main`.
**Module state:** `route` is OFF by default in production — these screens are inert until an
admin enables Route Management, so nothing is user-visible yet.

---

## 1. What shipped

Three screens, all `UI → hooks → SDK → RPC` (no component touches Supabase for route writes):

- **Route List** (`/routes`) — server-paginated table, search, status filter (default Active +
  Draft), status pill, customer count, gated New / Clone / Archive-Restore, row → workspace.
- **Route Wizard** (`/routes/new`) — 4 steps: Details → Customers → Sequence → Review.
- **Route Workspace** (`/routes/[id]`) — header + **Overview / Customers / Planning / History**
  tabs (built as a workspace, not an edit form).

---

## 2. User journeys

**Admin builds a beat (happy path, no dragging):**
`/routes` → New Route → enter name + pick assignee → *Save draft & continue* → **Import all** →
Continue (skip sequencing) → Review shows health + first stops → **Activate** (or Submit for
approval if the account requires it) → lands on the workspace.

**Admin curates a route:** open workspace → Customers tab → drag to reorder, remove one, or
**Select → Remove N** in bulk, or **Add customers** (Sheet: Import all / search-select) → Edit
header via the slide-over **Sheet** (warns before discarding) → Overview shows the health score
falling/rising with actionable warnings.

**Approver:** a route in *Pending approval* shows **Approve / Reject** (reason prompted) on the
header for users with `approve_routes`; History records who did what, when, and the reason.

---

## 3. Decisions & refinements — where each landed

| Item | Where implemented |
|---|---|
| D1 create-early draft | Wizard saves a `draft` at step 1 (real id for import/reorder) |
| D1 draft cleanup | Documented as a future maintenance job (not built) — see §6 |
| D2 health detail-only | List shows status + count only; health lives in the Workspace Overview |
| D5 default filter Active+Draft | List default filter |
| Sequencing optional | Wizard step 3 is skippable; happy path never drags |
| Route Preview before activation | Wizard Review step (health + first stops + approval-aware button) |
| Enterprise scale (R5) | Server pagination + search on list & pickers; per-page counts (no full-table fetch) |
| Next Scheduled (refinement 1) | Workspace Overview, derived from planner assignments |
| Edit Sheets (not inline) | `RouteEditSheet` slide-over with unsaved-change guard |
| Timeline grouped by date | Workspace History tab |
| Actionable health warnings | Overview health summary — each warning states the fix |
| Bulk customer actions | Customers tab Select mode → Remove N |
| Warn before discarding | Edit Sheet + bulk-remove confirm |
| Workspace order (Header→Customers→Planning→History) | Header card + Overview/Customers/Planning/History tabs |

---

## 4. UX state coverage

Every screen implements loading, empty, error (with retry), and permission-denied. List has a
distinct filtered-empty state; the Workspace has a not-found state; mutations show optimistic
updates (reorder) with rollback, and success/error toasts. Dark-mode uses the shared tokens
throughout. Archived routes render read-only (no edit/add/remove/reorder controls).

---

## 5. Architecture adherence

- No route screen calls `supabase` directly; all reads/writes go through `@/hooks/route` → the
  Route SDK. (One reference read — the employee dropdown — is a plain profiles read via a hook,
  consistent with how the app reads reference data elsewhere; it is not a route write.)
- Permissions gate affordances only; the server re-checks every action (verified in Phase 1).
- `@dnd-kit` (approved) powers sequencing; `CustomerImportPicker` is shared by the Add-customers
  Sheet (and should be adopted by the Wizard too — see §6).

---

## 6. Known limitations & follow-ups (honest list)

1. **Live browser QA not yet performed.** Verification to date is typecheck (0 errors),
   533/533 unit tests, and a clean production build. Interactive QA needs the module enabled on a
   test account with data — I can drive a full click-through via the preview browser once you
   enable it (or review on your deployed instance). Recommend doing this before 2c.
2. **Wizard still has its own inline customer picker;** the reusable `CustomerImportPicker` (used
   by the Workspace) should replace it. Deferred to avoid destabilizing the committed wizard —
   a small, safe cleanup.
3. **Bulk remove is sequential** (one RPC per customer, each resequences). Fine for tens; for
   removing hundreds at enterprise scale a dedicated `route_remove_customers` (plural) RPC would
   be better — a future DB addition (needs a migration + your gate).
4. **Abandoned-draft cleanup** (D1) is documented but not built — a future job archiving/deleting
   drafts with no customers older than N days. No UI impact today.
5. **Planning tab is read-only** here by design; assigning/moving is the Planner (2c).
6. **Draft delete:** there is no hard-delete in the UI (drafts can't be archived per the state
   machine, and no delete RPC exists). Drafts are handled by the future cleanup job. Confirm this
   is acceptable, or we add a `route_delete` RPC.

---

## 7. Recommendation

Phase 2b is functionally complete and passes all automated checks. Before Planner (2c) I
recommend: (a) a live browser walkthrough (enable the module on a test account and I'll verify +
capture screenshots), and (b) your call on the §6 items — especially #6 (draft delete) and
whether #2/#3 cleanups happen now or are backlogged.

On your approval (and the §6 calls), Phase 2c (Weekly Planner: grid, assign, move, copy, clear +
bulk copy) begins.

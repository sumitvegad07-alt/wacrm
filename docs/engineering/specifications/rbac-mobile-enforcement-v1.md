# RBAC Mobile Enforcement v1 — Login access + field rules

**For:** Antigravity (wacrm-mobile, React Native / Expo).
**Status:** Web + database side DONE & live (module-wise RBAC Phases 1–3). This spec covers the
ONLY remaining part — enforcement that must run inside the Android app.

## 1. Context / why this exists

The web admin now lets an admin configure module-wise rights per employee role
(`employee_roles.permissions` JSONB). Every web + database write is already enforced. Five of
those rights, plus mobile login access, can only be enforced **inside the mobile app** because
they gate on device state (an active visit check-in, an attendance punch-in, a live camera):

| Permission key | Meaning when GRANTED | When NOT granted |
|---|---|---|
| `order_without_checkin` | Can create an Order without an active visit check-in | Must be checked in to a customer first |
| `payment_without_checkin` | Can record a Payment without an active visit check-in | Must be checked in first |
| `visit_without_punchin` | Can check in to a customer without punching in for attendance | Must punch in (attendance) first |
| `punch_selfie_required` | *(required-rule)* Must capture a selfie on punch in/out | No selfie required |
| `odometer_photo_required` | *(required-rule)* Must capture an odometer photo | No odometer photo required |
| `mobile_access` | May sign in to the Android app | Cannot sign in on mobile |

Note the two shapes: the `*_without_*` keys are **permissive** (granted = fewer restrictions);
the `*_required` keys are **restrictive** (granted = an extra step is enforced).

## 2. How to read a permission on mobile

The signed-in user's role permissions are on their profile:
`profile.employee_role.permissions` (JSONB, e.g. `{"order_without_checkin":"true", ...}`).

Implement/verify a `hasPermission(key)` helper that mirrors the web contract
(`wacrm-web/src/lib/auth/rbac.ts` — read it, do not reinvent the rules):

- `permissions.all === true` → **true** (full-access role).
- account role `owner` / `admin` → **true** (bypass).
- `permissions[key] === "true"` → **true**.
- `add_`/`create_` alias both resolve (not relevant to these keys, but keep the helper uniform).
- otherwise **false**.

**Reuse check:** search `wacrm-mobile` for an existing permission helper and
`PermissionWrapper.tsx` (`src/components/auth/`) before writing a new one — extend it.

## 3. Grandfather defaults (already done — do NOT re-seed)

To keep current field reps working the moment this ships, existing non-full-access roles were
already backfilled in the database with `order_without_checkin`, `payment_without_checkin`,
`visit_without_punchin` = `true` (migration `20260823181000`). The `*_required` keys are left
unset (absent = not required). **Do not backfill again**; just read the keys.

## 4. Behavior to implement

### 4.1 Login (`mobile_access`)
In the sign-in flow (`wacrm-mobile/lib/auth-context.tsx` — same file that already blocks a
`pending` device), after the profile loads:

- If the user is `owner`/`admin`, always allow.
- Else if `hasPermission('mobile_access')` is **false**, sign the user out and show:
  “This account does not have mobile app access. Please contact your administrator.”
- This mirrors the web app, which already blocks web login when web access is off.

**STOP AND ASK:** confirm whether mobile access should read the role key (`mobile_access`) or the
per-employee `profiles.mobile_access` boolean (default true) — the web side used the profile
boolean `web_access`. Pick ONE source of truth and use it for both surfaces; do not read both
inconsistently.

### 4.2 Order / Payment creation (`order_without_checkin` / `payment_without_checkin`)
On the Order-create and Payment-create screens:

- Determine if there is an **active visit check-in** for the current user (reuse the existing
  visit/check-in state — search `VisitService.ts` / the visit context; do not invent a new
  source).
- If there is **no** active check-in AND the user does **not** have the matching
  `*_without_checkin` permission → block the action with a clear message
  (“Check in to a customer before taking an order.”) and route them to check-in.
- If they have the permission, OR there is an active check-in → allow.

### 4.3 Visit check-in (`visit_without_punchin`)
On the customer check-in action:

- If the user is **not punched in** for attendance AND does **not** have `visit_without_punchin`
  → block with “Punch in for attendance before visiting a customer.”
- Else allow.

### 4.4 Punch in/out (`punch_selfie_required`, `odometer_photo_required`)
In the attendance punch in/out flow:

- If `hasPermission('punch_selfie_required')` → the selfie capture step is **mandatory**
  (cannot complete punch without it). Otherwise it stays optional/skippable as today.
- If `hasPermission('odometer_photo_required')` → the odometer photo step is **mandatory**.
  Otherwise optional as today.
- These are additive gates on the existing punch flow — reuse the existing camera/selfie
  components; do not add a new capture library.

## 5. Reuse check (search these before writing)
`lib/auth-context.tsx` (login + device gate), `src/components/auth/PermissionWrapper.tsx`,
`VisitService.ts` and the visit/check-in state, the attendance punch in/out screen, any existing
`hasPermission` helper. Match existing naming and the offline-first pattern.

## 6. Open questions
1. Source of truth for `mobile_access` — role key vs `profiles.mobile_access` (see 4.1).
2. Should a blocked order/payment be fully prevented, or allowed-with-warning that syncs a flag?
   (Recommend fully prevented, matching the intent.)
3. Offline: check-in/punch-in state must be readable offline for these gates — confirm the
   local store already holds it, or wire it via `SyncEngine` (handbook Step 1.5).

## 7. Acceptance criteria (Definition of Done)
- **Functional:** all six behaviors in §4 enforced; granted role bypasses the restriction; a
  role without the key hits the block; owner/admin/full-access always pass.
- **Security:** gates read the real role permissions (not a hardcoded list); no client bypass
  that a rebuild would remove — where a write must be truly prevented, the block is before the
  Supabase call.
- **Offline:** gates evaluate correctly with no connectivity (permissions + check-in/punch
  state read from local state), and don’t crash when that state is missing.
- **Code quality / Architecture:** TypeScript strict, reuse existing permission + visit +
  punch code, no new libraries.
- **Testing:** manual matrix on a device — for each of the six keys: granted vs not, checked-in
  vs not, punched-in vs not.
- **Docs / Production readiness:** note any new convention for the handbook; confirm current
  field reps are NOT blocked on first launch (grandfather defaults from §3).

## 8. Antigravity Implementation Contract

```markdown
## Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles, and
   code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase before writing new code. Specifically search for: an existing
   `hasPermission` helper, `PermissionWrapper.tsx`, `lib/auth-context.tsx` login/device gate,
   `VisitService.ts` and the visit/check-in state, and the attendance punch in/out screen.
4. Identify the actual naming conventions used in the codebase by inspecting real files — do
   not assume a convention.
5. Do not assume offline support exists for this feature. `SyncEngine`
   (`wacrm-mobile/src/core/SyncEngine/`) currently only covers `site_visits` and timeline
   `activities`. These permission gates must still evaluate offline (they read local role +
   visit/punch state); confirm that state is available offline before writing code.

### Step 2 — STOP AND ASK triggers
Do not guess or silently choose a default in any of these situations. Stop and ask a specific
question instead:
- The `mobile_access` source-of-truth question in Open Questions (role key vs profile boolean).
- You find existing code that conflicts with what this spec describes.
- The spec doesn't specify behavior for a case you've encountered (an error/permission edge).
- You are about to introduce a new library, dependency, or pattern not already used.
- You are about to change a shared component/service in a way that could affect other features.

### Step 3 — Implementation rules
- TypeScript strict mode: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — extend the existing permission/visit/punch code.
- Match the permission keys in this spec EXACTLY (§1). Deviation is a STOP AND ASK.
- Respect multi-tenant isolation; never weaken it.
- Preserve offline-first behavior — the gates must work with no connectivity.

### Step 4 — Self-verification before declaring done
Check against every item in Section 7 (Acceptance Criteria), category by category (Functional,
Code Quality, Architecture, Testing, Security, Performance, Documentation, Production
Readiness). If any item can't be verified in your environment, say so explicitly.

### Step 5 — Report back
Report: what was implemented mapped to sections; any deviations and why; any new conventions
discovered; any acceptance items you could not fully verify and why.
```

# OZZO QA — Phase 2 Findings & Phase 3 Fix Plan

**Date:** 2026-09-16
**Scope chosen:** Deep on top-risk modules first. **Status: report only — NO fixes applied. Awaiting approval before any code change.**
**Companion:** [`2026-09-16-qa-cycle-plan.md`](./2026-09-16-qa-cycle-plan.md)

Baseline re-confirmed today: `wacrm-web` → 1216 tests pass, `tsc --noEmit` clean. All three repos have clean working trees.

---

## A. Confirmed findings (ranked)

### F1 — Stored XSS: unsanitized user HTML rendered with `dangerouslySetInnerHTML` — **HIGH**
- **Where:** [`announcements/[id]/page.tsx:121`](../../src/app/(dashboard)/announcements/[id]/page.tsx) renders `data.content`; [`quotations/[id]/page.tsx:316`](../../src/app/(dashboard)/quotations/[id]/page.tsx) renders `quotation.terms_conditions`. Both authored via rich-text editors (`terms-editor.tsx`, announcement form) and stored as raw HTML.
- **Root cause:** HTML is rendered verbatim. Verified: **no `dompurify`/`sanitize-html` in `package.json`, and no sanitize call on either path.**
- **Impact:** A user with `announcement.create` or `quotation.create` rights can store `<img src=x onerror=…>`-style markup that executes in the browser of anyone who opens the record — including an admin. Cross-tenant is blocked by RLS, but **intra-tenant session/token theft and privilege escalation are real.** This is authenticated stored XSS.
- **Confidence:** CONFIRMED (code + dependency audit).

### F2 — `SECURITY DEFINER` trigger with mutable `search_path` — **MEDIUM**
- **Where:** [`061_expense_enhancements.sql:62-123`](../../supabase/migrations/061_expense_enhancements.sql) — `log_expense_activity()` is `SECURITY DEFINER` with no `SET search_path`.
- **Root cause:** Definer function resolves unqualified object names against the caller-influenced `search_path`. The rest of the codebase pins `search_path` on definer functions; this one was missed.
- **Impact:** Classic Postgres `function_search_path_mutable` lint. Exploitability is limited on locked-down Supabase (needs create rights on a schema in the path), but it's a real hardening gap and an inconsistency.
- **Breadth:** A repo-wide grep suggests a handful of older definer functions may share this gap (heuristic is noisy — it counts comments). **Authoritative next step: run Supabase `get_advisors(type: security)` (read-only, safe) to get the exact `function_search_path_mutable` list.**
- **Confidence:** CONFIRMED for `log_expense_activity`; breadth PLAUSIBLE pending advisor.

### F3 — Dashboard date boundaries use device/runtime timezone, not account timezone — **LOW-MEDIUM**
- **Where:** [`src/lib/dashboard/date-utils.ts:6`](../../src/lib/dashboard/date-utils.ts) `startOfLocalDay` uses `Date.setHours(0,0,0,0)`; consumed by `sales-queries.ts`, `workforce-queries.ts`, `queries.ts`, `payment-queries.ts` and rendered from `"use client"` dashboard sections.
- **Root cause:** "today"/"this month" boundaries are computed in the **viewer's device** timezone and never consult `accounts.settings.timezone`. This contradicts the established ruling that reports/dates are **account-local** (the report engine uses `AT TIME ZONE`; the dashboard does not).
- **Impact:** Masked for India users on IST devices (device TZ == account TZ). Breaks when they differ — a traveling user, a wrong device clock, or any future non-IST tenant sees KPI tiles bucket early-morning activity into the wrong day. Low real-world impact today; a latent correctness/consistency bug.
- **Confidence:** CONFIRMED (client-rendered; no account-TZ input).

## B. Latent risks / technical debt (not bugs today)

- **F4 (LOW):** Territory flat-geo trigger [`20260916120000`](../../supabase/migrations/20260916120000_contacts_denormalize_geo_from_territory.sql) hardcodes level→column mapping (1=Country…4=Area). A tenant that reconfigures territory-level semantics would get mislabeled flat geo. Matches documented design, so a design risk to revisit, not a live bug. **Note:** this migration is local-only — not yet applied to prod.
- **F5 (LOW, debt):** `wacrm-web` ships root-level scratch scripts (`uat_certification.ts`, `uat_investigation.ts`, `uat_measure_semantics.ts`, `final_certification.ts`, `math_proof.ts`, `test-schema.js`, `check_type.js`, `create_test_user.js`, `login_test_user.js`, `scratch_check.js`, `test.ts`). They pollute lint (part of the 1184 `src`-adjacent errors) and shouldn't be in the app repo.
- **F6 (coverage gap):** `wacrm-mobile` has **no automated tests and no typecheck script**, despite carrying safety-critical parity logic (geofence, sync, soft-delete). Highest-leverage coverage investment.

## C. Verified clean (negative evidence — no action needed)

- **Geofence parity** — client `geofence.ts` and server trigger match exactly (cap=100, identical Haversine, same allow/reject boundary). No drift.
- **Payments financials** — `financials.ts` FIFO ageing, NUMERIC-string coercion, credit-limit-0 handling all correct and well-tested.
- **RLS `auth.uid()` init-plan** — already wrapped in `(select auth.uid())` by `20260913120000` (157 policies).
- **Report-date serialization** — guarded by `src/tests/reporting/report-date-serialization.test.ts`.

---

## Phase 3 — Fix plan

### Quick Wins (low risk, low regression)

**Fix F1 — sanitize rendered HTML.**
- **Files:** `announcements/[id]/page.tsx`, `quotations/[id]/page.tsx`; add a shared `src/lib/security/sanitize-html.ts`.
- **Proposed fix:** Add a sanitizer (`isomorphic-dompurify`, works in RSC + client) with an allowlist of the tags/attrs the rich-text editor actually emits (from `terms-editor.tsx`). Wrap both `__html` values: `dangerouslySetInnerHTML={{ __html: sanitize(value) }}`. Also sanitize on write in the editors as defense-in-depth.
- **Risk:** Low. **Regression risk:** Low — must confirm the allowlist covers legitimate formatting (bold/lists/links/tables) so existing terms don't get stripped.
- **Verification:** Unit test `sanitize()` strips `<script>`, `onerror=`, `javascript:` URLs while preserving allowed formatting; manual render of an existing quotation's terms unchanged.

**Fix F5 — remove/quarantine root scratch scripts.**
- **Files:** the 11 root scripts.
- **Proposed fix:** Delete the dead ones; move any still-useful UAT harness under `scripts/` and add to `.eslintignore` / tsconfig excludes.
- **Risk:** Low. **Regression risk:** Very low (not imported by the app — verify with a grep first).
- **Verification:** `eslint src` error count drops; `tsc` still clean; `vitest run` still 1216 green.

### Medium risk

**Fix F2 — pin `search_path` on definer functions.**
- **Files:** a **new** migration `supabase/migrations/2026…_pin_definer_search_path.sql` (never edit an applied migration). Recreate `log_expense_activity()` (and any others the advisor flags) with `SET search_path = public, pg_temp`.
- **Risk:** Medium (touches DB). **Regression risk:** Low — behavior identical, only name resolution pinned.
- **Verification:** `get_advisors(security)` before/after shows the `function_search_path_mutable` warnings cleared. **DB apply stays a manual founder step against prod — never applied in-session.**

**Fix F3 — make dashboard boundaries account-local.**
- **Files:** `date-utils.ts` + the four dashboard query modules; thread `accounts.settings.timezone` in.
- **Proposed fix:** Compute day/month boundaries in the account timezone (mirror the report engine's `AT TIME ZONE` approach) instead of `setHours`.
- **Risk:** Medium (touches every KPI tile). **Regression risk:** Medium — needs tests pinning boundaries for a non-IST account and an IST account.
- **Verification:** New unit tests for `startOfAccountDay(tz)`; snapshot KPI counts for a fixture spanning the IST-midnight/UTC-midnight gap.

### Deferred / bigger investments

- **F6:** stand up a minimal vitest (or jest) harness + `typecheck` script in `wacrm-mobile`, starting with the geofence and sync-critical pure functions. Separate effort.
- **F4:** revisit only if a tenant needs non-standard territory levels.

---

---

## Implementation status (Phase 4) — branch `qa/2026-09-16-quality-fixes`

| Finding | Status | Commit | Evidence |
|---------|--------|--------|----------|
| **F1** XSS | **FIXED** | `ac39815` | `isomorphic-dompurify` sanitizer + 5 unit tests; wired into 2 render sites + 3 editor-load sinks; 1221 tests green, tsc clean |
| **F5** scratch scripts | **FIXED** | `3f679ce` | 11 files removed; lint 1812→1779 problems; tsc clean |
| **F2** definer search_path | **MIGRATION WRITTEN, NOT APPLIED** | `04201b5` | Precise scan found exactly 1 real offender (`log_expense_activity`); `update_updated_at_column` was a parser false-positive (it is `LANGUAGE plpgsql`, invoker). Prod apply = manual founder step |
| **F3** dashboard TZ | **DEFERRED — reassessed as systemic** | — | See below |

### F3 reassessment
On implementation, a codebase-wide grep found **no account-timezone mechanism at all**: no `AT TIME ZONE` in report code, nothing reads `accounts.settings.timezone` in the query layer. The entire app treats "local" as **device-local**, which is correct-in-practice for a single-timezone (India/IST) user base. The dashboard is therefore **consistent** with the rest of the app, not a localized defect. Threading account-TZ math into only the dashboard would make it *inconsistent* with every other screen and add regression risk for **zero real-world benefit today**. Correct fix = a **codebase-wide account-timezone strategy** (a separate initiative), not a dashboard patch. Deferred deliberately.

---

## Recommendation for next step

Approve the **Quick Wins (F1, F5)** to implement first in an isolated local branch with TDD + regression tests (nothing pushed). F2/F3 need a DB migration and account-TZ threading respectively — implement locally, but the F2 prod apply remains your manual step. F1 is the one I'd prioritize: it's a live, authenticated stored-XSS path.

# OZZO QA Cycle — Plan & Phase 1 Analysis

**Date:** 2026-09-16
**Owner:** QA cycle (Claude Code, driven by Superpowers workflow)
**Guardrail:** No push / merge / deploy / production-DB / production-Supabase / prod-env changes without explicit founder approval. Everything stays local and reversible.

---

## 1. Repositories in scope

| Repo | Stack | Branch | Tests | Typecheck | Lint |
|------|-------|--------|-------|-----------|------|
| `wacrm-web` | Next.js 16, React 19, Supabase SSR, TanStack Query | `main` (clean) | **1216 pass / 90 files** (vitest) | **clean** (`tsc --noEmit`) | 1184 errors in `src/` (mostly `no-explicit-any`) |
| `wacrm-mobile` | Expo 57, RN 0.86, expo-router | `master` (clean) | none co-located; `playwright` dep present | not run yet | not configured |
| `ozzo-site` | Next.js 16 marketing site | `main` (clean) | none | not run yet | `next lint` |

Baseline evidence captured 2026-09-16. All three working trees are clean.

## 2. Baseline health (Phase 1 findings)

**Green:**
- Web unit suite is comprehensive and fully green (1216 tests). Strong coverage in `payments`, `automations`, `flows`, `location`, `import`, `plans`, `auth`, `reporting`.
- Web `tsc --noEmit` passes with zero errors — type safety is solid.

**Yellow (technical debt, not regressions):**
- **1184 ESLint errors in `src/`**, overwhelmingly `@typescript-eslint/no-explicit-any`. These are style/debt, not runtime bugs. Not fixing wholesale this cycle.
- **Root-level scratch scripts** shipped in the web repo: `uat_certification.ts`, `uat_investigation.ts`, `uat_measure_semantics.ts`, `final_certification.ts`, `math_proof.ts`, `test-schema.js`, `check_type.js`, `create_test_user.js`, `login_test_user.js`, `scratch_check.js`, `test.ts`. These pollute lint and the repo. Candidate for removal / `.eslintignore`.
- **Mobile has no automated tests** and no typecheck script. Highest test-coverage gap.

## 3. High-risk modules (ranked, from code + memory)

1. **Payments / financials** — prior prod-pollution incident (2026-08-14/16); money math, statuses, duplicates, requirement toggles.
2. **Reports / report-engine** — timezone (`AT TIME ZONE`) bugs historically invisible for months; DSR, sales, visit, ageing, expense, task.
3. **Imports** — universal framework + territory/geo denorm; recent fixes (4edba81, f3d6f51) around blank city→territory; create-territory path.
4. **Territory + geo denormalization** — BEFORE-write trigger denormalizing hierarchy into flat cols; migration `20260916120000` **not yet applied to prod DB** (manual step).
5. **RLS / RBAC / data-scope** — multi-tenant isolation, reporting-hierarchy directional scoping, DB backstops.
6. **GPS / geo-fencing / attendance** — visit check-in/out fencing, tracking sessions, shift-time semantics.
7. **Price lists / schemes / GST** — pricing engine v5 override→blanket→catalogue; GST determinant snapshotting for Tally.
8. **Route management** — planner/execution, assignee_id vs user_id keying.
9. **Web ↔ mobile parity** — soft-delete parity (#10 open), form defaults, realtime sync.

## 4. QA cycle phases & checkpoints

- **Phase 1 — Analysis (this doc). DONE.**
- **Phase 2 — Bug discovery.** Read-only. Systematic review of high-risk modules + full-repo static checks. Produce a ranked bug report (CRITICAL/HIGH/MEDIUM/LOW). **No fixes.** → *checkpoint: report reviewed before any code change.*
- **Phase 3 — Fix plan.** Per-issue root cause, files, proposed fix, risk, regression risk, verification. Grouped Quick Wins / Medium / High. → *checkpoint: approval before implementing.*
- **Phase 4 — Safe implementation.** Isolated worktree per fix group. TDD + regression tests. Tests + typecheck after each. **No push/deploy.**
- **Phase 5 — Code review.** `requesting-code-review` + `security-review` on the diff; fix findings; repeat until clean.
- **Phase 6 — Local env.** `next dev` (web) verified via built-in browser; mobile/expo start if feasible. Report local URLs + test-account approach.
- **Phase 7 — Manual QA test plan.** Full module checklist (steps / expected / priority).
- **Phase 8 — Execute QA.** Automated first, then manual validation. PASS/FAIL/BLOCKED.
- **Phase 9 — Verification-before-completion.** Real command outputs, no unverified success claims.
- **Phase 10 — Final report.** Issues found/fixed, remaining risks, tech debt, security, coverage gaps, QA results, recommendations. **No push/merge/deploy — wait for approval.**

## 5. Discovery method (Phase 2)

For each high-risk module: read the module + its tests, trace the risky paths (money math, timezone conversion, tenant/scope filters, geo denormalization, null/edge inputs), and cross-check web vs mobile where a shared behavior exists. Static sweeps across the repo for known anti-patterns (`.toISOString()` on report dates, `auth.uid()` un-wrapped in RLS, sequential awaits on hot save paths, `confirm()` leftovers, missing `is_active` filters). Use the green unit suite as the regression net; add failing tests to prove each real bug before proposing a fix.

## 6. Safety ledger

- Migration `20260916120000` (territory geo denorm) is **local only** — not applied to prod. Any DB work stays in local migration files unless founder runs it.
- No `execute_sql` / `apply_migration` against prod without explicit approval.
- Fixes will be committed to a **local isolated branch/worktree only**; nothing pushed.

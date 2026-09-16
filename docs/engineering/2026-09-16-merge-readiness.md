# OZZO QA — Merge-Readiness Assessment

**Date:** 2026-09-16 · **Branch:** `qa/2026-09-16-quality-fixes` (5 fix/doc commits) · **NOT merged / pushed / deployed.**

## Evidence collected (all fixes)
| Evidence | Result | Notes |
|---|---|---|
| Unit tests (`vitest run`) | **1221 pass / 91 files** | includes 5 new `sanitize-html` tests; run 3×, stable |
| TypeScript (`tsc --noEmit`) | **exit 0** | clean |
| Production build (`next build`) | **exit 0** | 150/150 static pages; new dep bundles cleanly |
| Lint (`eslint .`) | 1812→**1779** problems | F5 removed 33; remainder = pre-existing `no-explicit-any` debt |
| Browser verification (sanitizer harness, real DOM) | **5/5 payloads neutralized** | `<script>`, `onerror`, `javascript:` all stripped; no `alert()` fired; formatting preserved |
| Real-data read-only (logged-in prod session) | **render path PASS** | live announcement content renders fully, formatting intact, no breakage |
| Security review (branch diff) | **no new vulns** | F1 closes the XSS; `style` in allowlist judged sub-threshold |

---

## F1 — Stored-XSS sanitizer · commit `ac39815`
### Verdict: **SAFE TO MERGE** (with one recommended post-merge visual check)
**Rationale**
- Security goal met: unsanitized `dangerouslySetInnerHTML`/`innerHTML` sinks now pass through a vetted allowlist sanitizer. Neutralization proven by **unit tests + real-browser-DOM harness (5/5)**.
- No regressions in the gates: tests, tsc, build all green; the new `isomorphic-dompurify` dependency builds and bundles.
- Formatting-preservation confirmed on **real production data** (announcement rendered intact) — the highest-risk regression (over-stripping legitimate content) did not occur.
- **Residual (low) risk:** the rich-text editor uses `document.execCommand`, which in some browsers emits `align="..."` attributes or `<font>` tags. The allowlist keeps `style` but not `align`/`font`, so a small amount of legacy alignment/font formatting *could* be dropped on re-render. Cosmetic only — not security or functional. Not observed on the data checked.
- **Not exercised:** live payload injection on the actual quotation/announcement page (would require writing malicious data to prod — deliberately not done). Covered indirectly by the identical `sanitizeRichText` code path verified on real data + unit/harness.

**Recommended before/after merge:** open one real quotation that *has* Terms & Conditions and confirm formatting looks right (5-min visual check). If any alignment/font is lost, add `align`/`font`/`text-align` handling to the allowlist — fix-forward, no revert needed.

**Rollback plan**
- Pre-deploy: `git revert ac39815` (restores raw rendering **and** removes the dependency, since both are in this one commit). ⚠️ Reverting re-opens the XSS — prefer fix-forward (widen the allowlist) over revert.
- If only the dependency is a problem: it's confined to `package.json`/`package-lock.json` in `ac39815`.

---

## F5 — Remove root scratch scripts · commit `3f679ce`
### Verdict: **SAFE TO MERGE**
**Rationale**
- 11 deleted files were verified **not imported** by any `src/` code or config (grep). Gates stayed green (tests/tsc/build), lint improved by 33. Zero functional surface.

**Rollback plan**
- `git revert 3f679ce` restores all 11 files verbatim (they remain in history regardless). Trivial and safe.

---

## F2 — Pin `search_path` on `log_expense_activity()` · commit `04201b5`
### Verdict: **NEEDS VERIFICATION**
**Rationale**
- The migration file is **inert until applied** — merging the file is harmless (it doesn't run in CI/build). But the **fix itself has never been executed** against any database: no local/staging Postgres was available (no `supabase/config.toml`; Docker not installed), and applying to prod is out of scope without approval.
- The statement is behaviour-preserving and the function signature was confirmed zero-arg from source, but "written and reasoned correct" ≠ "verified." It must be run once and confirmed.
- Classification is about the *fix being trustworthy live*, so: **NEEDS VERIFICATION** — even though the file can merge, don't consider F2 "done" until applied + advisor-confirmed.

**Verification steps (before calling F2 done)**
1. Apply on a non-prod DB (or as the founder's deliberate prod step): `supabase db push` / run `20260916130000_pin_definer_search_path.sql`.
2. Confirm it applies without error and an expense create still logs its activity (trigger path intact).
3. Run `get_advisors(type: security)` — `log_expense_activity` should no longer appear under `function_search_path_mutable`.

**Rollback plan**
- Pre-apply: `git revert 04201b5` (removes the migration file). Nothing else changed.
- Post-apply (if the pin ever needs undoing): `ALTER FUNCTION public.log_expense_activity() RESET search_path;` — restores the prior (unpinned) state; body untouched throughout.

---

## Summary
| Fix | Verdict | Blocking gap |
|---|---|---|
| **F1** XSS sanitizer | **SAFE TO MERGE** | none blocking; optional 5-min visual check of a quotation with Terms |
| **F5** scratch cleanup | **SAFE TO MERGE** | none |
| **F2** definer search_path | **NEEDS VERIFICATION** | migration never executed; apply + `get_advisors` on a non-prod DB first |
| — | **DO NOT MERGE** | none — no fix is unsafe |

**Suggested sequence (when you approve):** merge F1 + F5 to main → normal Vercel deploy → do the F1 visual check. Handle F2 separately: apply the migration to a non-prod DB (or prod as your manual step), verify via `get_advisors`, then it's done. Nothing here has been merged, pushed, or deployed.

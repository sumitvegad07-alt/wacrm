# SQL ↔ TypeScript pricing parity

`calculate_order_pricing` exists twice: authoritatively in Postgres (migration
077) and as an advisory mirror in `calculateOrderPricing.ts`. The mirror is
needed because suggestions and live totals must work with no network, and
mobile order entry must work with no signal at all.

Two implementations of the same rules will drift unless something pins them
together. `fixtures.ts` is that pin. The cases below are run against **both**.

## How to re-run

**TypeScript side** — automated, part of `npm test`:

```bash
npx vitest run src/lib/pricing
```

**SQL side** — not automated, because it needs a real database connection and
the test runner has no credentials. Run it through the Supabase MCP (or any
psql session) as a single batch. It inserts the fixture catalogue, exercises
every case, then **rolls back**, so it is safe to run against production:

```
BEGIN;
DO $par$ ... $par$;   -- see git history of this file / the session transcript
ROLLBACK;
```

The block ends in a deliberate `RAISE EXCEPTION` so it cannot commit even if
the trailing `ROLLBACK` were lost. Verify afterwards that `tax_slabs` is empty
and product/contact counts are unchanged.

Re-run the SQL side whenever migration 077 or the pricing rules change.

## Recorded results — 22 July 2026

Run against production (rolled back). Every case matched the fixture
expectations in `fixtures.ts`.

| Case | sub_total | tax_total | total | discount | classification | valid |
|---|---|---|---|---|---|---|
| 01 plain, no discount, no tax | 1000.00 | 0.00 | 1000.00 | 0 | direct | true |
| 02 tax at 18% | 1000.00 | 180.00 | 1180.00 | 0 | — | true |
| 03 line percentage discount | 900.00 | 162.00 | 1062.00 | 100.00 | — | true |
| 04 line flat-amount discount | 850.00 | 0.00 | 850.00 | 150.00 | — | true |
| 05 discount capped at line | 0.00 | — | 0.00 | 200.00 | — | true |
| 06 order discount pro-rata (2 lines) | 1800.00 | 162.00 | 1962.00 | 200.00 | — | true |
| 07 order flat discount capped | 0.00 | — | 0.00 | 100.00 | — | true |
| 08 floor breached, enforcement ON | 500.00 | 90.00 | 590.00 | 500.00 | — | **false** |
| 09 floor breached, enforcement OFF | 500.00 | 90.00 | 590.00 | — | — | true |
| 10 hierarchy on, level 1 | — | — | — | — | **primary** | — |
| 11 hierarchy on, level 2 | — | — | — | — | **secondary** | — |
| 12 hierarchy on, level not set | — | — | — | — | **direct** | — |
| 13 locked price on edited line | 750.00 | 0.00 | 750.00 | 0 | — | true |
| 14 zero quantity | 0.00 | 0.00 | 0.00 | 0 | — | true |
| 15 awkward rounding (33.33 ×3 @ 12.5%) | 99.99 | 12.50 | 112.49 | 0 | — | true |

Case 06 also returned per-line effective unit prices of `90.0000 / 90.0000`,
confirming the whole-order discount is split across lines rather than held at
the header — which is what lets each line's tax reduce correctly.

Case 15 is the one that catches floating-point drift: 12.5% of 99.99 is
12.49875. Postgres NUMERIC rounds to `12.50`; the TypeScript mirror's
`round()` helper agrees. A naive `Math.round` implementation does not
reliably, which is why that helper exists.

## Recorded results — 26 July 2026 (engine_version 2: inclusive tax)

Re-run against production (rolled back) after upgrading the mirror to
engine_version 2 — the per-line tax basis (migrations 083/084). The whole 20-case
suite matched field-for-field, SQL vs TypeScript. The five inclusive cases below
are new; the 15 above were re-confirmed unchanged and every one still returned
`engine_version = 2`.

The harness sets `order_settings.hierarchy_enabled` / `enforce_price_floor` per
case and inserts the fixture catalogue under a real account, then ends in a
`RAISE EXCEPTION E'PARITY_RESULTS_BEGIN … END'` that carries the results in the
error text and guarantees rollback. Verified afterwards: zero fixture products /
slabs / contacts remain and the account's settings are unchanged.

Note for the harness: production has the migration-076 trigger
`trg_enforce_contact_hierarchy_level` live (BEFORE INSERT OR UPDATE on
`contacts`), so the block must disable hierarchy before inserting the NULL-level
fixture contact, then re-enable it per case.

| Case | tax_mode | sub_total | tax_total | total | disc | eff. unit | rate_incl_unit | valid |
|---|---|---|---|---|---|---|---|---|
| INC1 inclusive, no discount | inclusive | 847.46 | 152.54 | 1000.00 | 0 | 100 | 100.00 | true |
| INC2 inclusive, per-unit ₹10 off ×5 | inclusive | 381.36 | 68.64 | 450.00 | 50 | 90 | 100.00 | true |
| INC3 inclusive, 30% → below floor 80 | inclusive | 593.22 | 106.78 | 700.00 | 300 | 70 | 100.00 | **false** |
| INC4 mixed (excl + incl) + 10% order disc | mixed | 1662.71 | 137.29 | 1800.00 | 200 | 90 / 90 | 100.00 / 100.00 | true |
| INC5 inclusive, awkward (33.33 ×3 @ 12.5%) | inclusive | 88.88 | 11.11 | 99.99 | 0 | 33.33 | 33.33 | true |

INC1 proves the inclusive split reconciles: 1000 inclusive → net 1000/1.18 =
847.46, tax = 1000 − 847.46 = 152.54, which add back to exactly 1000. INC3 proves
the floor is checked against the **inclusive** per-unit price (70 < 80) — the
effective unit price is derived from the native (inclusive) amount, not the net.
INC4 proves each line keeps its own basis while the whole-order discount is still
split pro-rata across both.

## Recorded results — 19 August 2026 (engine_version 3: schemes, Phase 4)

Migration `20260819160000_scheme_engine.sql` adds `detect_eligible_schemes` and
upgrades `calculate_order_pricing` to consume confirmed scheme effects. Two new
fixture groups pin the two functions:

- **Engine (`calculate_order_pricing`)** — 5 new cases in `PRICING_FIXTURES`
  feeding `scheme_id` / `scheme_discount_amount` / `is_scheme_goods` per line and
  `p_order_schemes` at the order level. When no scheme inputs are present the
  function is byte-identical to v2, so all 20 pre-Phase-4 cases must re-confirm
  and now return `engine_version = 3`.
- **Detection (`detect_eligible_schemes`)** — 8 cases in
  `SCHEME_DETECTION_FIXTURES`, proving step_up/repeat slab matching, the
  best-single-per-line tie-break, the free-unit cap, value-slab qualification,
  date-window expiry, and customer targeting.

**Status: BOTH SIDES VERIFIED 2026-08-19.** TypeScript: `npx vitest run
src/lib/pricing` = 36/36 green. SQL: migration `20260819160000_scheme_engine.sql`
applied to production (project `gxurqwpfvfktmreqmzqb`) and confirmed by a
self-contained, forced-rollback harness (fixture account settings + products +
schemes created, every case exercised, then `RAISE EXCEPTION` to roll everything
back). Post-run check: `engine_version = 3` live, one signature each of
`calculate_order_pricing` / `detect_eligible_schemes` (old 5-arg dropped), and
**zero** fixture products / contacts / tax-slabs / schemes left behind.

Engine cases — SQL matched TypeScript field-for-field:

| Engine case | sub_total | tax_total | total | discount_total | valid | eff. unit |
|---|---|---|---|---|---|---|
| quantity_slab money reward (₹100 off, 18% tax) | 900.00 | 162.00 | 1062.00 | 100.00 | true | 90 |
| free-goods ₹0 line adds nothing (floor-exempt) | 1000.00 | 180.00 | 1180.00 | 0.00 | true | 100 / 0 |
| scheme + salesman jointly capped | 0.00 | 0.00 | 0.00 | 1000.00 | true | 0 |
| value_slab 3% pro-rata across 2 lines | 1940.00 | 174.60 | 2114.60 | 60.00 | true | 97 / 97 |
| value_slab scoped to one line only | 1950.00 | 0.00 | 1950.00 | 50.00 | true | 100 / 95 |
| regression: plain P2 (no scheme) → still v3 | 1000.00 | 180.00 | 1180.00 | 0.00 | true | 100 |
| regression: inclusive tax (no scheme) | 847.46 | 152.54 | 1000.00 | 0.00 | true | 100 |

Detection cases — SQL matched TypeScript:

| Detection case | result |
|---|---|
| step_up picks 20+ slab (10%) on qty 25 | ₹250 line discount ✓ |
| free_goods step_up (buy 12) | free_qty 1, default_selected false ✓ |
| free_goods repeat, cap 5 (buy 65 → 6 sets) | free_qty 5 (capped) ✓ |
| best-per-line by priority (qty 20) | ₹100 discount_amount (priority scheme wins) ✓ |
| value_slab ₹60k basket | ₹1800, positions [1] ✓ |
| value_slab two tiers, ₹60k | ₹1800 (3% tier) + nudge value_to_next 40000 → "5% off" ✓ |
| value_slab ₹40k (below ₹50k floor) | no order scheme ✓ |
| expired scheme | no line schemes ✓ |
| targeting excludes non-listed customer | no line schemes ✓ |
| targeting includes listed customer | ₹250 ✓ |

**Bug the harness caught (and the reason it exists):** the value_slab branch had a
`CONTINUE WHEN NOT FOUND OR v_slab.id IS NULL` where the `FOUND` flag had already
been clobbered by the "next tier" nudge `SELECT` running first — so a qualifying
value scheme was silently skipped. TypeScript (separate control flow) was correct;
only SQL drifted. Fixed by testing the matched slab (`v_slab.id IS NULL`) directly
and moving the nudge query after that check (migration
`scheme_engine_phase4_valueslab_fix`). Re-ran the harness: all green.

### Re-running the harness

The harness is a single `DO $harness$ … RAISE EXCEPTION … $harness$;` block run
through the Supabase MCP `execute_sql`. It picks the oldest real account, forces
`order_settings.hierarchy_enabled=false` / `enforce_price_floor=true`, inserts the
fixture catalogue (products `aaaaaaaa-…-0001/0002/0003`, tax slabs 18% / 12.5%, a
targeting contact) and per-case schemes, runs every case building a results
string, then `RAISE`s to guarantee rollback. The full block is in the session
transcript for 2026-08-19. Re-run it whenever the migration or the pricing rules
change, and re-confirm zero fixture rows remain afterward.

## What is NOT covered yet

- The SQL scheme functions are written but not yet dry-run-verified (above).
- Price lists (Phase 3) remain a labelled pass-through and contribute nothing.
- Order persistence of confirmed schemes (create_order/update_order forwarding
  the new per-line scheme fields + p_order_schemes, and the server-side
  drift/quoted-wins re-check) is a later slice — not in this migration.
- The SQL side is not wired into CI. If a test database ever becomes
  available (Supabase Pro branching, or a local Supabase CLI stack), automate
  it — a manual check is only as good as the person remembering to run it.

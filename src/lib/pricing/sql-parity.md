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

## What is NOT covered yet

- Price lists (Phase 3) and schemes (Phase 4). Both steps exist in the SQL as
  labelled pass-throughs and contribute nothing today. When they are built,
  add fixtures for them **before** implementing, and extend this table.
- The SQL side is not wired into CI. If a test database ever becomes
  available (Supabase Pro branching, or a local Supabase CLI stack), automate
  it — a manual check is only as good as the person remembering to run it.

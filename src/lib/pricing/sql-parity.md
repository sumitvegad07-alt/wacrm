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

## What is NOT covered yet

- Price lists (Phase 3) and schemes (Phase 4). Both steps exist in the SQL as
  labelled pass-throughs and contribute nothing today. When they are built,
  add fixtures for them **before** implementing, and extend this table.
- The SQL side is not wired into CI. If a test database ever becomes
  available (Supabase Pro branching, or a local Supabase CLI stack), automate
  it — a manual check is only as good as the person remembering to run it.

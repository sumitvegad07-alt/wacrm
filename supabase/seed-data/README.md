# Territory Master — seed data (pinned sources)

`territory-seed.json` is the **single, pinned source** for the default territory tree. It is
committed so the source is auditable rather than "whatever is on the internet" (Territory
Master spec, Open Question 4).

Flow: `scripts/generate-territory-seed.mjs` reads this JSON and emits
`src/lib/territories/seed-data.generated.ts`. The Territory Master empty-state "Load default
India data" CTA dynamically imports that module and passes the three arrays to the
idempotent, admin-only `territory_bulk_seed(account_id, countries, states, districts)` RPC
(`supabase/migrations/103_seed_default_territories.sql`), which builds the tree
(country → India's states → districts) in one transaction.

## Structure

- `countries` — 249 entries, `{ name, code }`. **Reference only** — as of the founder's
  2026-07-31 decision only **India** is actually seeded; admins add any other country manually
  via the tree's "Add Country". The generator hard-codes `SEED_COUNTRIES = [India]`.
- `india_states` — 36 entries (28 states + 8 UTs), `{ name, code }`. Level 2, parented to the
  `India` country row.
- `india_districts` — 762 entries, `{ state, name }`. Level 3 (mapped to the default **City**
  level), parented to the matching state/UT row.

Total seed rows per account: **799** (India + 36 states/UTs + 762 districts).

## Provenance (pinned)

| Slice | Source | Pin |
|---|---|---|
| Countries | ISO 3166-1, `github.com/lukes/ISO-3166-Countries-with-Regional-Codes` → `all/all.json` (`name`, `alpha-2`) | master branch, fetched 2026-07-31 |
| India states + districts | `github.com/iaseth/data-for-india` → `data/readable/districts.json` | commit `06577f0d2019fe9a93e6a258be3902b17b7d1cf3` (2023-04-16) |

## Honesty note on "LGD"

Open Question 4 asked for LGD (Local Government Directory) districts. The official LGD portal
(`lgdirectory.gov.in`) is an interactive portal without a clean public flat file. The pinned
`iaseth/data-for-india` dataset **reflects current LGD administrative divisions** — it is
up to date on the post-2019 changes (Ladakh as a UT with Leh + Kargil; the merged
"Dadra and Nagar Haveli and Daman and Diu"; the 2022 Andhra Pradesh reorganisation; Uttar
Pradesh's full 75 districts) — but it is a community-maintained mirror, not a byte-for-byte
LGD export. 762 districts vs. LGD's ~780 (a handful of the newest districts may be missing).
This was the most complete, current, single, pinnable source found; alternatives were either
truncated (KTBsomen, capped at 25 districts/state) or dated (sab99r, missing Ladakh).
Admins can add, edit, archive, or bulk-import the remainder through the Territory Master UI.

## Regenerating

```bash
node scripts/generate-territory-seed.mjs
```

Re-fetches nothing; it reads the committed `territory-seed.json` and rewrites
`src/lib/territories/seed-data.generated.ts`. To refresh the underlying data, update
`territory-seed.json` from the pinned sources above and re-run.

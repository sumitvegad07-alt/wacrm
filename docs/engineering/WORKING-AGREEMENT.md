# Working agreement — don't break what already works

Written 2026-11-06, after a one-line additive migration took two whole screens
down in production.

This is the process for every new module, feature, bug fix or "small" change,
in this session and every session after it.

---

## 1. What actually went wrong, because the rule comes from it

On 2026-11-03 a migration added one column:

```sql
ALTER TABLE orders ADD COLUMN parent_contact_id uuid REFERENCES contacts(id);
```

Additive. Nullable. Nothing dropped, nothing renamed. About the safest change
there is — and it was the **second** foreign key from `orders` to `contacts`.
PostgREST immediately stopped being able to resolve `contacts(*)` on orders and
answered every such request with PGRST201. The web order page reads any error
as "no order" and bounced to the list; the mobile Orders list treats a failed
query as zero rows and showed an empty screen.

Every order, on both platforms, for three days.

Three things let it through, and each one is a rule below:

- **Nothing executed the query.** `tsc` does not look inside a PostgREST select
  string, and no test opened an order.
- **There was nowhere safe to click.** `.env.local` points at Mumbai, so
  "running it locally" means running against live data — which makes casual
  verification risky, so it does not happen.
- **The schema change and the code that depended on it were never compared.**
  The SQL was reviewed as SQL.

The lesson is not "be more careful". It is that *safe-looking schema changes
are the dangerous ones*, and only a machine will catch them.

---

## 2. The gates. All of them, before anything reaches `main`

| # | Gate | Command | Catches |
|---|------|---------|---------|
| 1 | Types | `npx tsc --noEmit` | signature and shape drift |
| 2 | Unit + guards | `npx vitest run` | logic, and the embed guard below |
| 3 | Design ratchet | `npm run lint:ui` | UI drift from the design system |
| 4 | Database | `bash scripts/run-db-tests.sh` | triggers, RLS, constraints, functions |
| 5 | Clicked through | see §4 | everything the four above cannot see |

Gate 4 is the local PostgreSQL harness: a throwaway PostgreSQL 17.6, all 292
migrations, 119 scenarios, one command, about six minutes. It needs no Docker
and no network. **Run it before every migration goes to prod**, not after.

Expect ~46 migration errors in its output — `storage.*`, realtime publications
and the `vector` extension do not exist on a bare PostgreSQL. Watch for a
*jump* in that number. Scenario failures are what matter.

### The guard that would have caught this bug

`src/lib/supabase/ambiguous-embeds.test.ts` (and its mobile twin) fails the
build if any `orders -> contacts` embed omits its foreign-key hint.

**When you add a second foreign key between two tables, add the pair to
`AMBIGUOUS_EMBEDS`.** One manual step. It turns a silent outage into red CI.

---

## 3. Before any schema change, answer these five

Keep it in the migration's own comment block, where the next person will read it.

1. **Is this the second FK between these two tables?** If yes, every
   `child(...)` embed between them must become `child!<constraint>(...)`, and
   the pair goes in `AMBIGUOUS_EMBEDS`.
2. **Does a column I am touching appear in a `.select()` string?**
   `grep -rn "<column>" src app` in **both** repos. Strings are invisible to
   the compiler.
3. **Does this add or change a trigger, policy or constraint on a table that
   already has writes?** Then it needs a scenario in `supabase/tests/`.
4. **Can an existing row fail the new rule?** A `NOT NULL`, a `CHECK` or a
   validating trigger applies to history as well as to new rows.
5. **What does this do to a tenant who has not configured the feature?** The
   answer must be "nothing".

## 4. Local first — and what that honestly means today

**Right now there is no non-production database.** `.env.local` points at
Mumbai (`ltigfpywdbfilsagtpyd`), and the E2E credentials in `.env.test.local`
are for tenant 001288, which also lives inside production. "Local" currently
means a local web server driving live data.

So, until that is fixed:

- Never click through a destructive flow against `.env.local`.
- Exercise schema and rule changes on the **local PostgreSQL harness** (gate 4),
  which is genuinely isolated.
- Any UI walkthrough uses the throwaway tenant, never a real customer's.

**The fix, and it should happen soon.** One of:

- **(a) Docker Desktop + `supabase start`** — a complete local Supabase
  (Postgres, Auth, PostgREST, Storage) from this repo's own migrations. Free,
  offline, resettable, and the dev server points at it by changing two values
  in `.env.local`. This is the right answer. Docker is not installed today.
- **(b) A second Supabase cloud project as staging** — no Docker, but a real
  project to pay for and seed, and still a network away.

(a) is better: it is the only option where a mistake cannot reach a customer.

## 5. Fixing a bug

1. **Write the failing test first**, at the lowest level that reproduces it —
   a scenario in `supabase/tests/` for a database rule, a vitest for logic.
2. Watch it fail **for the right reason**. A guard that has never been seen to
   fail is not a guard: the first version of the embed test above scanned line
   by line, missed the real bug, and passed happily. It was only caught by
   re-introducing the bug deliberately.
3. Fix it. Watch the test pass.
4. Run all five gates.
5. Say in the commit message what was broken, why nothing caught it, and what
   now would.

## 6. Shipping

- `main` deploys to Vercel, so `main` is production. Never push a red build.
- Migrations do not deploy themselves. They are applied by hand on Mumbai, in
  one transaction, **after** gate 4 is green — and the matching code must be
  deployed at the same time or the two disagree.
- Mobile changes need an APK before they exist for anyone.
- Say plainly what was verified and what was not. "Tests pass" and "I opened
  it and it worked" are different claims.

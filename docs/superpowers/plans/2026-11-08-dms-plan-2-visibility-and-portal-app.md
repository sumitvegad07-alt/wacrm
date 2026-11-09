# OZZO DMS — Plan 2: Visibility and the portal app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer who has been given a portal login can sign in at the new DMS app, see themselves and everyone below them in the customer tree, and read their orders, payments and outstanding — and can see nothing of any other distributor and nothing whatsoever of any other tenant. No existing policy on `contacts`, `orders` or `payments` is edited to make this work.

**Architecture:** A portal customer is an `auth.users` row with **no `profiles` row**, so `is_account_member` is false for them and every existing RLS policy already returns zero rows. That is the whole security model, and Task 3 proves it by measurement rather than assuming it. Visibility is then granted back through a small list of `security definer` functions, all of which stand on **one** zero-argument resolver, `portal_visible_contact_ids()`, which walks `contacts.parent_id` downward from the caller with the account check inside the recursion and a depth cap. The portal UI is a **separate Next.js app in its own repository** which holds the anon key only; it can mint no users and has no privileged path to any table.

**Tech Stack:** PostgreSQL 17.6 (Supabase, Mumbai `ltigfpywdbfilsagtpyd`). Portal app: Next.js 16.2.6, React 19.2.4, TypeScript, Tailwind 4, `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.107, `lucide-react`, Vitest + @testing-library/react. CRM app: unchanged stack.

**Spec:** `docs/engineering/specifications/ozzo-dms-product-v1.md` — sections 4, 5.1, 5.4, 6, 6.1, 12 and 15. Read §6 before Task 4; it explains why no existing policy is reopened.

**Plan 2 of 4.** Plan 1 (foundation: the add-on, seats, logins) is complete and live on production. Plan 3 is ordering. Plan 4 is announcements, the private activity list and four reports. At the end of this plan a distributor can sign in and look at their business; they cannot yet place an order.

## Global Constraints

- **Nothing is pushed.** The founder's instruction: "Once we will completely develop everything test everything than we will Push everything to live." Every task commits to `main` in `C:\Wacrm\wacrm-web` and stops there. `git push` is forbidden in this plan. The portal app is a **local** git repository at `C:\Wacrm\ozzo-dms` with no remote.
- **`.env.local` points at PRODUCTION.** Never run a migration, a script or `npm run dev` against it. Never open a browser on it. SQL is verified on the throwaway cluster only; the founder applies it by hand from `docs/RUN-THIS-SQL-dms-plan-2.md`.
- **Every change is global to all tenants by default.** Behaviour is scoped by the add-on, never by an account id in code.
- **An account without the DMS add-on must be byte-identical to today:** no new column on a list, no new query, no new menu entry, no new setting. 14 of the 15 live tenants are in that state.
- Migration filenames are `supabase/migrations/YYYYMMDDHHMMSS_name.sql` in byte order. This plan uses the `20261108*` range.
- Every SQL function sets `search_path` explicitly — `''` (then schema-qualify everything) or `public`, matching the file it sits beside. Never leave it unset. Every new function gets `ALTER FUNCTION ... OWNER TO postgres;` for house style.
- Dates are account-local: convert `AT TIME ZONE` the account's timezone, never `toISOString()`.
- The founder reads plain English. Every string an admin or a distributor can see says what to do, and never carries a raw Supabase or Postgres message.
- Before every commit in `wacrm-web`: `npm run typecheck` and `npm test`. Also `npm run lint:ui` whenever a `.tsx` changed — it is a **ratchet** currently at **347 / 18 / 15 / 132**; verify against a stashed baseline and never let it rise.
- The SQL harness is `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`, about six minutes. **Run one at a time** — two concurrent runs destroy each other's cluster. Expect **46** migration errors; that number is known noise and must not change. A new scenario file must be added **by name** to the `for f in ...` list in `scripts/run-db-tests.sh`, or it never runs while the suite still reports green.
- **`qa_refused` passes on ANY exception, including a syntax error.** A psql `:VAR` expands to an already-quoted literal, so concatenating it raw into dynamic SQL is a syntax error that reports PASS. This fault occurred five times in Plan 1. Use `quote_literal(:VAR)`. For every refusal scenario, state in a comment what would happen if the rule it tests were deleted — if the answer is not "this scenario fails", the scenario is worthless.
- `npm test` **reads production**: four `src/lib/mcp/*` suites do so by design (`src/lib/mcp/test-db.ts` refuses any project ref but Mumbai). A failing suite is **suspect, never "flaky"**. Never describe a failure whose output you did not open.

---

### Task 1: Wire the DMS add-on into the nine `owns` maps

Plan 1 widened `ProductLine` to include `"dms"` and every `Record<ProductLine, boolean>` literal in the UI had to gain a key. They were all given the constant `false`, because at the time `accounts.addon_lines` was not yet applied on production and `use-auth` could not read it. It is applied now, `useAuth()` already exposes `hasDMS` (`src/hooks/use-auth.tsx:224`, computed at line 567 from `accountLines`), and the nine constants are the last thing standing between a `surface-gates` row of `line: "dms"` and it working. Plan 1's final review asked for this weakening to be short-lived; this is it.

**Files:**
- Modify: `src/hooks/use-nav-items.ts:54`
- Modify: `src/components/layout/sidebar.tsx:610`
- Modify: `src/components/layout/command-palette.tsx:49`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx:96`
- Modify: `src/app/(dashboard)/import/page.tsx:53`
- Modify: `src/app/(dashboard)/import/[module]/page.tsx:47`
- Modify: `src/app/(dashboard)/custom-fields/[module]/page.tsx:26`
- Modify: `src/app/(dashboard)/reports/page.tsx:33`
- Modify: `src/app/(dashboard)/settings/page.tsx:107`
- Test: `src/lib/plans/dms-owns-wiring.test.ts` (create)
- Test: `src/lib/plans/surface-gates.dms.test.ts` (create)

**Interfaces:**
- Consumes: `useAuth().hasDMS: boolean` (already exported); `gatePasses(gate, ctx)` and `GateContext` from `src/lib/plans/surface-gates.ts`; `ProductLine` from `src/lib/plans/catalog.ts`.
- Produces: `owns.dms === hasDMS` in all nine surfaces, so a `SurfaceGate` of `{ line: "dms" }` becomes usable by Plans 3 and 4. No new exports.

- [ ] **Step 1: Write the failing tests**

Two tests, because they catch different failures. The first is a **source scan** — the only thing that can notice a constant creeping back in, and the repo already has precedent for source-level assertions (`scripts/check-design-system.mjs`, `proposal-pages.test.tsx`). The second proves the gate itself discriminates.

Create `src/lib/plans/dms-owns-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The nine surfaces that build a Record<ProductLine, boolean> called `owns`.
// Plan 1 gave each of them the constant `dms: false` because addon_lines was
// not on production yet. It is now. A constant here makes every DMS surface
// gate silently false, which is exactly how a paid feature ships invisible —
// so this list is pinned in a test rather than trusted to memory.
const OWNS_FILES = [
  "src/hooks/use-nav-items.ts",
  "src/components/layout/sidebar.tsx",
  "src/components/layout/command-palette.tsx",
  "src/app/(dashboard)/dashboard-shell.tsx",
  "src/app/(dashboard)/import/page.tsx",
  "src/app/(dashboard)/import/[module]/page.tsx",
  "src/app/(dashboard)/custom-fields/[module]/page.tsx",
  "src/app/(dashboard)/reports/page.tsx",
  "src/app/(dashboard)/settings/page.tsx",
];

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("the DMS add-on is wired into every owns map", () => {
  it("has all nine files still present", () => {
    // A rename that drops a file from this list would make the suite pass by
    // testing nothing, so prove each path resolves first.
    for (const f of OWNS_FILES) {
      expect(read(f).length, f).toBeGreaterThan(0);
    }
  });

  it("never hardcodes dms to a constant", () => {
    for (const f of OWNS_FILES) {
      const src = read(f);
      expect(src, `${f} still hardcodes dms`).not.toMatch(/\bdms:\s*(false|true)\b/);
    }
  });

  it("reads dms from hasDMS in every one of them", () => {
    for (const f of OWNS_FILES) {
      const src = read(f);
      expect(src, `${f} does not read hasDMS`).toMatch(/\bdms:\s*hasDMS\b/);
    }
  });
});
```

Create `src/lib/plans/surface-gates.dms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gatePasses } from "./surface-gates";
import type { ProductLine } from "./catalog";

function ctx(dms: boolean) {
  const owns: Record<ProductLine, boolean> = {
    crm: true, wfa: true, sfa: true, fsm: false, dms,
  };
  return { owns, isModuleEnabled: () => true };
}

describe("a surface gated on the dms line", () => {
  it("passes for an account that holds the add-on", () => {
    expect(gatePasses({ line: "dms" }, ctx(true))).toBe(true);
  });

  it("is refused for an account that does not", () => {
    // Before this task this assertion passed for the wrong reason: owns.dms
    // was the constant false everywhere, so the gate could never be true.
    expect(gatePasses({ line: "dms" }, ctx(false))).toBe(false);
  });

  it("composes with anyLine, which is how DMS will be sold beside SFA", () => {
    expect(gatePasses({ anyLine: ["sfa", "dms"] }, ctx(false))).toBe(true);
    expect(gatePasses({ anyLine: ["dms"] }, ctx(false))).toBe(false);
    expect(gatePasses({ anyLine: ["dms"] }, ctx(true))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test -- src/lib/plans/dms-owns-wiring.test.ts src/lib/plans/surface-gates.dms.test.ts`

Expected: the wiring test FAILS on all nine files (`still hardcodes dms`). The surface-gates test PASSES already — `gatePasses` is pure and reads whatever `owns` it is handed; it is there to pin the contract the nine files must now satisfy, and to be the thing Plans 3 and 4 rely on.

- [ ] **Step 3: Wire the three hook-shaped surfaces**

These three keep `owns` inside a hook or a `useMemo`, so `hasDMS` must also join the dependency array. **A stale dependency array is the fault that once made four whole modules appear unbuilt while Save reported success** — check every one of the three, and do not add `hasDMS` to the destructure without adding it to the deps.

`src/hooks/use-nav-items.ts` — add `hasDMS` to the `useAuth()` destructure, change line 54 to `dms: hasDMS,`, and add `hasDMS` to the dependency array of the hook/`useMemo` that encloses `owns`.

`src/components/layout/command-palette.tsx` — add `hasDMS` to the `useAuth()` destructure at line 47, change line 49 to `dms: hasDMS`, and add `hasDMS` to the `useMemo` dependency array on that same `owns`.

`src/app/(dashboard)/dashboard-shell.tsx` — add `hasDMS` to the `useAuth()` destructure, change line 96 to `dms: hasDMS,`, and add `hasDMS` to the dependency array of the route-protection `useEffect` (the one that ends `router,` around line 123, listing `hasCRM, hasWFA, hasSFA, hasFSM`).

- [ ] **Step 4: Wire the six plain-render surfaces**

In each, add `hasDMS` to the `useAuth()` destructure and replace `dms: false` with `dms: hasDMS`. Where the `owns` literal sits inside a `useEffect` or `useMemo`, add `hasDMS` to that dependency array too — check each one; `reports/page.tsx` and `settings/page.tsx` both read `owns` inside an effect.

- `src/components/layout/sidebar.tsx:610`
- `src/app/(dashboard)/import/page.tsx:53`
- `src/app/(dashboard)/import/[module]/page.tsx:47`
- `src/app/(dashboard)/custom-fields/[module]/page.tsx:26`
- `src/app/(dashboard)/reports/page.tsx:33`
- `src/app/(dashboard)/settings/page.tsx:107`

Replace the trailing comment `// add-on line: not wired to the UI yet` with `// granted per account via accounts.addon_lines, never by a plan code` wherever it appears, so the five words that are now false do not survive.

- [ ] **Step 5: Run the two tests and the type check**

Run: `npm test -- src/lib/plans/dms-owns-wiring.test.ts src/lib/plans/surface-gates.dms.test.ts && npm run typecheck`

Expected: both files pass, `tsc --noEmit` clean.

- [ ] **Step 6: Prove nothing in the menu moved for an account without the add-on**

This is the constraint that matters. There is no `surface-gates` row with `line: "dms"` yet, and this task adds none, so for every one of the 15 live tenants the nine maps now carry `dms: false` (14 of them) or `dms: true` (001001) and **no gate reads it**. Confirm by search, and record the count in the report:

Run: `grep -c '"dms"' src/lib/plans/surface-gates.ts`

Expected: `0`. If it is not 0, a row has been added that this task did not ask for — remove it; adding the first `dms` row is Plan 3's or Plan 4's job, in the task that needs it.

- [ ] **Step 7: Run the whole suite and the ratchet**

```bash
git stash && npm run lint:ui > /tmp/lintui-baseline.txt; git stash pop && npm run lint:ui > /tmp/lintui-after.txt; diff /tmp/lintui-baseline.txt /tmp/lintui-after.txt
```

Then: `npm test`

Expected: the ratchet diff is empty (baseline 347 / 18 / 15 / 132). The full suite passes with 2 more test files than before. If any suite fails, **open its output** and report what it says — do not call it flaky, and do not re-run and declare the first run void.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-nav-items.ts src/components/layout/sidebar.tsx src/components/layout/command-palette.tsx "src/app/(dashboard)/dashboard-shell.tsx" "src/app/(dashboard)/import/page.tsx" "src/app/(dashboard)/import/[module]/page.tsx" "src/app/(dashboard)/custom-fields/[module]/page.tsx" "src/app/(dashboard)/reports/page.tsx" "src/app/(dashboard)/settings/page.tsx" src/lib/plans/dms-owns-wiring.test.ts src/lib/plans/surface-gates.dms.test.ts
git commit -m "The DMS add-on reaches the UI gates instead of being hardcoded off"
```

---

### Task 2: Migration — close Plan 1's two portal security residuals

Plan 1's final review left two holes open and named them Plan 2's first SQL job. Both have to be shut **before** the resolver ships, because the resolver is built on the assumption that neither exists.

**Hole 1 — `contacts.portal_user_id` is not unique.** Two customers could carry the same login. `portal_visible_contact_ids()` would then root at both and merge two unrelated sub-trees into one distributor's view. That is a cross-distributor leak inside a tenant, created by an admin mistake rather than an attack.

**Hole 2 — `contacts` has no column guard on the six `portal_*` columns.** `contacts_update` is a row policy, and PostgreSQL row policies cannot restrict columns. The API route writes these columns with the **service-role key** (`src/app/api/portal-access/route.ts:123`), so no legitimate end-user write touches them — but a tenant admin can `PATCH` their own customer through PostgREST and rewrite the **displayed** `portal_email` while sign-in still uses the real `auth.users` email. The customer page would then show one address and the distributor would sign in with another, and nobody could explain it. The same door lets an admin set `portal_user_id` to another tenant's auth user.

**Hole 3, cosmetic, folded in here because it is one line of the same subject:** the seat trigger raises `'All 1 portal logins are in use…'`. The TypeScript wording was fixed in commit 9527d24 (`src/lib/admin/portal-login-text.ts`); the database's own sentence was not.

**Files:**
- Create: `supabase/migrations/20261108100000_portal_columns_guard_and_unique_login.sql`
- Modify: `supabase/tests/60_dms_foundation.sql` (append section L)
- Create: `docs/RUN-THIS-SQL-dms-plan-2.md`

**Interfaces:**
- Consumes: `public.is_superadmin()`; `public.enforce_portal_seat_cap()` (redefined here, message only); the role test in `public.guard_account_commercial_columns()` (`supabase/migrations/20261107150000_accounts_commercial_columns_guard.sql:69`) — copy it **character for character** so the two "is this caller trusted" tests cannot drift.
- Produces: unique index `contacts_portal_user_unique_idx`; trigger `trg_guard_contact_portal_columns` on `public.contacts`; function `public.guard_contact_portal_columns()`.

- [ ] **Step 1: Give the founder the pre-flight check**

The index cannot build if production already holds two contacts with the same `portal_user_id`. Plan 1's verification recorded exactly one portal login across all 15 tenants, so it cannot — but record the check rather than the belief. This query goes in the RUN-THIS-SQL document **above** the block:

```sql
-- Must return no rows. If it returns any, two customers share one login and
-- the unique index below will fail until one of them is cleared.
select portal_user_id, count(*)
  from public.contacts
 where portal_user_id is not null
 group by portal_user_id
having count(*) > 1;
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261108100000_portal_columns_guard_and_unique_login.sql`:

```sql
-- ============================================================
-- Two holes Plan 1's final review left open, and one wrong sentence.
--
-- 1. ONE LOGIN, ONE CUSTOMER. contacts.portal_user_id had no unique index, so
--    two customers could carry the same login. Plan 2's visibility resolver
--    walks DOWN the customer tree from "the customer this login is", so two
--    roots would merge two unrelated distributors' sub-trees into one view —
--    a leak inside a tenant, caused by an admin mistake rather than an attack.
--
-- 2. THE DISPLAYED LOGIN COULD BE REWRITTEN. contacts_update is a ROW policy,
--    and PostgreSQL row policies cannot restrict COLUMNS. The portal-access
--    API route writes the six portal_* columns with the SERVICE-ROLE key
--    (src/app/api/portal-access/route.ts), so no legitimate end-user write
--    touches them. But a tenant admin could PATCH their own customer through
--    the API and change portal_email, while sign-in still uses the real
--    auth.users address: the customer page would show one login and the
--    distributor would use another, with nothing to explain the difference.
--    The same door let an admin point portal_user_id at any auth user,
--    including another tenant's.
--
-- 3. "All 1 portal logins are in use." The seat trigger's sentence does not
--    bend for a count of one. The TypeScript copies were fixed in 9527d24
--    (src/lib/admin/portal-login-text.ts); this is the database's own.
--
-- WHO IS EXEMPT, AND WHY IT IS SAFE. Identical construction to
-- guard_account_commercial_columns (20261107150000): the guard applies only
-- when current_setting('role') is 'authenticated' or 'anon', which are the only
-- roles a client request can arrive on. Inside a SECURITY DEFINER function
-- current_user is the owner and session_user is `authenticator` for BOTH a user
-- and the service role; the `role` GUC is the only one that discriminates, and
-- SECURITY DEFINER does not change it.
--
-- WHY THE COMPARISON COMES FIRST. contacts is the busiest table in the product,
-- and on 2026-11-04 a guard on it refused an unrelated write and took the order
-- save down with it. Comparing the six columns before anything else means a
-- mistake in the role handling below can only ever affect a write that really
-- changes a portal column — an ordinary name or address edit, the outstanding
-- recalculation, the area-parent sync, the customer-code trigger and the
-- territory denormalisation all return at the first IF.
--
-- If this ever blocks something it should not:
--   DROP TRIGGER trg_guard_contact_portal_columns ON public.contacts;
-- ============================================================

-- ── 1. One login, one customer ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS contacts_portal_user_unique_idx
  ON public.contacts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

-- The plain lookup index from 20261107130000 is now redundant: this unique
-- index serves the same "which customer is this login?" probe. Dropped so the
-- table does not carry two indexes on one column.
DROP INDEX IF EXISTS public.contacts_portal_user_idx;

-- ── 2. The six portal columns are set by the portal-access route only ──
CREATE OR REPLACE FUNCTION public.guard_contact_portal_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Cheapest test first. Nothing about the login changed, so there is nothing
  -- to guard, and every ordinary write to this very busy table leaves here.
  IF TG_OP = 'UPDATE' AND NOT (
         NEW.portal_user_id           IS DISTINCT FROM OLD.portal_user_id
      OR NEW.portal_email             IS DISTINCT FROM OLD.portal_email
      OR NEW.portal_access            IS DISTINCT FROM OLD.portal_access
      OR NEW.portal_access_revoked_at IS DISTINCT FROM OLD.portal_access_revoked_at
      OR NEW.portal_access_set_by     IS DISTINCT FROM OLD.portal_access_set_by
      OR NEW.portal_access_set_at     IS DISTINCT FROM OLD.portal_access_set_at) THEN
    RETURN NEW;
  END IF;

  -- An INSERT that mentions none of them is an ordinary new customer. All six
  -- default to NULL except portal_access, which is NOT NULL DEFAULT false.
  IF TG_OP = 'INSERT'
     AND NEW.portal_user_id IS NULL
     AND NEW.portal_email IS NULL
     AND NEW.portal_access IS NOT TRUE
     AND NEW.portal_access_revoked_at IS NULL
     AND NEW.portal_access_set_by IS NULL
     AND NEW.portal_access_set_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Not an end-user API role: the service role (which is what the
  -- portal-access route uses), the SQL editor, a migration, a DBA.
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A platform superadmin signed in as an ordinary user.
  IF to_regprocedure('public.is_superadmin()') IS NOT NULL
     AND public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Portal logins are changed on the customer page, not directly. Use Provide DMS Access.'
    USING ERRCODE = 'insufficient_privilege';
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_contact_portal_columns() OWNER TO postgres;

-- Named so it sorts AFTER trg_enforce_portal_seat_cap ('e' < 'g'): the seat
-- trigger may clear portal_access_revoked_at itself, and this guard must judge
-- the record as it will actually be written.
DROP TRIGGER IF EXISTS trg_guard_contact_portal_columns ON public.contacts;
CREATE TRIGGER trg_guard_contact_portal_columns
  BEFORE INSERT OR UPDATE OF
    portal_user_id, portal_email, portal_access,
    portal_access_revoked_at, portal_access_set_by, portal_access_set_at
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_portal_columns();

-- ── 3. "All 1 portal logins are in use." ─────────────────────
-- Byte-identical to 20261107130000 except the RAISE. Reproduced in full rather
-- than patched, because CREATE OR REPLACE replaces the whole body.
CREATE OR REPLACE FUNCTION public.enforce_portal_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_limit    integer;
  v_used     integer;
  v_was_held boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_was_held := OLD.portal_user_id IS NOT NULL
              AND OLD.portal_access IS TRUE
              AND OLD.portal_access_revoked_at IS NULL
              AND OLD.account_id = NEW.account_id;
  END IF;

  IF NEW.portal_access IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_was_held THEN
    IF NEW.portal_access_revoked_at IS NOT NULL THEN
      NEW.portal_access := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT account_has_line(NEW.account_id, 'dms') THEN
    RAISE EXCEPTION 'This account does not have the DMS. Portal access cannot be given.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text, 0));

  SELECT portal_seats_limit INTO v_limit
    FROM accounts WHERE id = NEW.account_id;
  v_used := portal_seats_used(NEW.account_id);

  IF v_used >= COALESCE(v_limit, 0) THEN
    IF COALESCE(v_limit, 0) = 1 THEN
      RAISE EXCEPTION 'The only portal login is in use. Remove access from another customer, or buy more.';
    ELSE
      RAISE EXCEPTION 'All % portal logins are in use. Remove access from another customer, or buy more.',
        COALESCE(v_limit, 0);
    END IF;
  END IF;

  NEW.portal_access_revoked_at := NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_portal_seat_cap() OWNER TO postgres;
```

- [ ] **Step 3: Write the harness scenarios**

Append a section **L** to `supabase/tests/60_dms_foundation.sql`. Read the end of that file first: section H leaves `portal_seats_limit` at 5 and `DIST_C` holding one seat, and section J works on `:ACCT`. Re-assert whatever you depend on rather than inheriting it.

```sql
-- ── L: one login per customer, and who may change a login ────
--
-- Deleting trg_guard_contact_portal_columns must make L3, L4, L5 and L7 fail.
-- Deleting contacts_portal_user_unique_idx must make L1b fail.
-- L2, L6 and L8 are non-regression: contacts is the busiest table in the
-- product and 2026-11-04's incident was a guard on it refusing an unrelated
-- write and taking the order save down.

\set ACCT   '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN  '''11110000-0000-0000-0000-000000000001'''
\set DIST_C '''c1000000-0000-0000-0000-00000000000c'''
\set C1     '''c0000000-0000-0000-0000-000000000001'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN, false);
UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 5 WHERE id = :ACCT;

-- L1: a FREE auth user id is accepted by the index, as the service role. This
-- is the control that proves L1b's refusal is about the duplicate and not about
-- the column guard or some unrelated failure.
SELECT qa_allowed('L1 the service role may link a customer to a free login id',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_user_id = ''00000000-0000-0000-0000-0000000000c1'''
  || ' WHERE id = ' || quote_literal(:C1));
RESET ROLE;

-- L1b: now point C1 at the SAME auth user DIST_C already uses. Still the
-- service role, so only the unique index can refuse it.
SELECT qa_refused('L1b two customers cannot share one portal login',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_user_id = (SELECT portal_user_id FROM public.contacts WHERE id = '
  || quote_literal(:DIST_C) || ') WHERE id = ' || quote_literal(:C1));
RESET ROLE;

-- L2: the service role still writes the login columns. This is the
-- portal-access route's own path; if it broke, no login could be created again.
SELECT qa_allowed('L2 the service role still sets a login email',
  'SET LOCAL ROLE service_role;'
  || ' UPDATE public.contacts SET portal_email = ''l2@abc.com'''
  || ' WHERE id = ' || quote_literal(:DIST_C));
RESET ROLE;

-- L3: the attack. A tenant ADMIN rewrites the displayed login address through
-- the API. Sign-in would still use the real auth.users email, so the customer
-- page would show an address nobody can sign in with.
SELECT set_config('test.uid', :ADMIN, false);
SET ROLE authenticated;
SELECT qa_refused('L3 a tenant admin cannot rewrite the displayed login email',
  'UPDATE public.contacts SET portal_email = ''hijack@abc.com'''
  || ' WHERE id = ' || quote_literal(:DIST_C));

-- L4: the worse version of L3 — repointing the login at another auth user.
SELECT qa_refused('L4 a tenant admin cannot repoint a login at another user',
  'UPDATE public.contacts SET portal_user_id = ''00000000-0000-0000-0000-0000000000ff'''
  || ' WHERE id = ' || quote_literal(:DIST_C));

-- L5: and cannot grant access by hand, bypassing the route entirely.
SELECT qa_refused('L5 a tenant admin cannot switch portal access on directly',
  'UPDATE public.contacts SET portal_access = true, portal_email = ''byhand@abc.com'''
  || ' WHERE id = ' || quote_literal(:C1));

-- L6: THE NON-REGRESSION THAT MATTERS. An ordinary admin edit to a customer
-- that HOLDS a login must still work. If the comparison-first ordering were
-- removed, this would fail and every customer edit on a DMS tenant would break.
SELECT qa_allowed('L6 an ordinary name edit on a customer WITH a login still works',
  'UPDATE public.contacts SET name = ''Dist C renamed'' WHERE id = ' || quote_literal(:DIST_C));

-- L7: an INSERT carrying a login is refused for an end-user role too, otherwise
-- the admin simply creates the customer with the login already attached.
SELECT qa_refused('L7 a tenant admin cannot create a customer with a login attached',
  'INSERT INTO public.contacts (account_id, user_id, name, phone, portal_email, portal_access)'
  || ' VALUES (' || quote_literal(:ACCT) || ', ' || quote_literal(:ADMIN)
  || ', ''Smuggled'', ''1999999999'', ''smuggle@abc.com'', true)');

-- L8: an ordinary new customer, with no portal columns at all, still inserts.
SELECT qa_allowed('L8 an ordinary new customer still inserts',
  'INSERT INTO public.contacts (account_id, user_id, name, phone)'
  || ' VALUES (' || quote_literal(:ACCT) || ', ' || quote_literal(:ADMIN)
  || ', ''Ordinary L8'', ''1999999998'')');

RESET ROLE;
DELETE FROM public.contacts WHERE account_id = :ACCT AND name = 'Ordinary L8';
UPDATE public.contacts SET name = 'Dist C' WHERE id = :DIST_C;
-- Leave C1 without a login so later files see the fixture they expect.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = NULL WHERE id = :C1;
RESET ROLE;
```

- [ ] **Step 4: Run the harness**

Run: `cd /c/Wacrm/wacrm-web && PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh 2>&1 | tail -40`

Expected: `298 migrations applied, 46 reported errors` — one more migration than Plan 1's 297, and the error count **unchanged** (a change means this migration itself errored). The scenario count rises by 9 from 175 to **184**, `0 failed`, and **no `TRUNCATED` line**. If the count does not rise by exactly 9, the file aborted part way or the edit did not save — Plan 1 hit both of those.

- [ ] **Step 5: Prove each refusal would fail if the rule were deleted**

Do not reason about this; measure it.

1. Comment out the `CREATE TRIGGER trg_guard_contact_portal_columns` statement, re-run the harness, record which scenarios fail. **L3, L4, L5 and L7 must all fail.**
2. Restore it. Comment out the `CREATE UNIQUE INDEX` statement instead, re-run, confirm **L1b fails**.
3. Restore everything and re-run clean.

Three extra harness runs, about twenty minutes. It is the step Plan 1 skipped five times, each time shipping a scenario that reported PASS while testing nothing. Report all three run summaries.

- [ ] **Step 6: Write the RUN-THIS-SQL document**

Create `docs/RUN-THIS-SQL-dms-plan-2.md`. Follow the shape of `docs/RUN-THIS-SQL-dms-foundation.md`: a plain-English paragraph saying what the block does and why, in words the founder uses; then the SQL in one fenced block he can paste whole; then what he should see; then how to undo it. Define "trigger" and "index" in one sentence each the first time they appear.

The block is the migration file's contents verbatim. Prove it and say so in the report:

```bash
cd /c/Wacrm/wacrm-web
sed -n '/^-- ============/,$p' supabase/migrations/20261108100000_portal_columns_guard_and_unique_login.sql | tr -d '\r' > /tmp/mig.sql
# extract the doc's first fenced sql block to /tmp/doc.sql the same way, then:
cmp /tmp/mig.sql /tmp/doc.sql && echo IDENTICAL
```

Include the pre-flight query from Step 1 above the block, with "must return no rows" stated, plus this note in plain words: the block is safe to apply while the app is running — `CREATE UNIQUE INDEX` without `CONCURRENTLY` takes a brief lock on the customer table that stops writes but not reads, and it builds in milliseconds on a few thousand rows.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261108100000_portal_columns_guard_and_unique_login.sql supabase/tests/60_dms_foundation.sql docs/RUN-THIS-SQL-dms-plan-2.md
git commit -m "One portal login per customer, and only the route may change one"
```

---

### Task 3: Prove a portal login can read nothing at all today

Spec §6 says a portal login "has `select` on nothing". That sentence is **not true of the grants** — Supabase grants `authenticated` SELECT on every table in `public`, and the harness grants the same (`scripts/run-db-tests.sh`). It is true because `is_account_member` (`supabase/migrations/017_account_sharing.sql:136`) reads `profiles` and nothing else, and a portal customer has no `profiles` row, so every policy that leans on it returns zero rows.

The whole security model therefore rests on a claim nobody has measured: **that no policy anywhere has a branch a profile-less authenticated user satisfies.** This task measures it, before granting the portal anything. It writes no production code.

**Files:**
- Create: `supabase/tests/70_portal_visibility.sql`
- Modify: `scripts/run-db-tests.sh` (add `70_portal_visibility` to the `for f in ...` list)

**Interfaces:**
- Consumes: the fixture's two tenants, and the `auth.uid()` override at `supabase/tests/00_bootstrap.sql:45`.
- Produces: the file every later visibility task appends to, and the portal fixture those tasks **must reuse** rather than inventing their own ids:
  - `PORTAL_U_A1` `00000000-0000-0000-0000-00000000a001` — login for tenant A's first distributor
  - `PORTAL_U_A2` `00000000-0000-0000-0000-00000000a002` — the distributor beside it, the cross-distributor control
  - `PORTAL_U_B1` `00000000-0000-0000-0000-00000000b001` — a login in tenant B
  - `DIST_A1` `cc000000-0000-0000-0000-0000000000a1`, `DIST_A2` `…a2`, `STK_A1` `…a3`, `DLR_A1` `…a4`, `DLR_A2` `…a5`, `DLR_ORPHAN` `…a6`, `DIST_B1` `cc000000-0000-0000-0000-0000000000b1`

- [ ] **Step 1: Build the fixture and the "reads nothing" assertions**

Create `supabase/tests/70_portal_visibility.sql`:

```sql
-- ============================================================
-- 2026-11-08 — the portal's visibility model, measured.
--
-- Spec §6 says a portal login has "select on nothing". That is NOT achieved by
-- revoking grants: Supabase grants `authenticated` SELECT on every public
-- table, and so does this harness. It is achieved because is_account_member
-- reads `profiles` and a portal customer has no profiles row — so every policy
-- that leans on it returns zero rows.
--
-- Nobody had ever measured that. Section O does, BEFORE any portal_* function
-- exists, so the baseline is honest: a portal login with the whole
-- `authenticated` grant set and no profile must read nothing.
--
-- Section N is the tree every later section reuses:
--
--   Tenant A                              Tenant B
--     DIST_A1  (login PORTAL_U_A1)          DIST_B1 (login PORTAL_U_B1)
--       STK_A1                                (one customer, nothing below)
--         DLR_A1
--     DIST_A2  (login PORTAL_U_A2)   <- the distributor beside A1
--       DLR_A2
--     DLR_ORPHAN  (no parent at all)  <- in nobody's portal, deliberately
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set ADMIN_B '''22220000-0000-0000-0000-000000000001'''

\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''
\set PORTAL_U_B1 '''00000000-0000-0000-0000-00000000b001'''

\set DIST_A1    '''cc000000-0000-0000-0000-0000000000a1'''
\set DIST_A2    '''cc000000-0000-0000-0000-0000000000a2'''
\set STK_A1     '''cc000000-0000-0000-0000-0000000000a3'''
\set DLR_A1     '''cc000000-0000-0000-0000-0000000000a4'''
\set DLR_A2     '''cc000000-0000-0000-0000-0000000000a5'''
\set DLR_ORPHAN '''cc000000-0000-0000-0000-0000000000a6'''
\set DIST_B1    '''cc000000-0000-0000-0000-0000000000b1'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- ── N: the tree ──────────────────────────────────────────────
-- Order hierarchy stays OFF for both tenants here. Migration 076 refuses ANY
-- update to a level-less customer while it is on — Plan 1's H7 limitation — and
-- section S switches it on deliberately, only there.
UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'false'::jsonb, true)
 WHERE id IN (:ACCT_A, :ACCT_B);

UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 10
 WHERE id IN (:ACCT_A, :ACCT_B);

ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

UPDATE public.contacts SET parent_id = NULL WHERE id IN
  (:DIST_A1, :DIST_A2, :STK_A1, :DLR_A1, :DLR_A2, :DLR_ORPHAN, :DIST_B1);
DELETE FROM public.contacts WHERE id IN
  (:DIST_A1, :DIST_A2, :STK_A1, :DLR_A1, :DLR_A2, :DLR_ORPHAN, :DIST_B1);
DELETE FROM auth.users WHERE id IN (:PORTAL_U_A1, :PORTAL_U_A2, :PORTAL_U_B1);

INSERT INTO auth.users (id, email) VALUES
  (:PORTAL_U_A1, 'dist-a1@portal.test'),
  (:PORTAL_U_A2, 'dist-a2@portal.test'),
  (:PORTAL_U_B1, 'dist-b1@portal.test');

-- Levels are set on every one: a level-less customer cannot be given a login on
-- a tenant running order hierarchy, and section S needs them levelled.
INSERT INTO public.contacts (id, account_id, user_id, name, company, phone, hierarchy_level) VALUES
  (:DIST_A1,    :ACCT_A, :ADMIN_A, 'Dist A1',  'Distributor A1', '3000000001', 1),
  (:DIST_A2,    :ACCT_A, :ADMIN_A, 'Dist A2',  'Distributor A2', '3000000004', 1),
  (:STK_A1,     :ACCT_A, :ADMIN_A, 'Stk A1',   'Stockist A1',    '3000000002', 2),
  (:DLR_A1,     :ACCT_A, :ADMIN_A, 'Dlr A1',   'Dealer A1',      '3000000003', 3),
  (:DLR_A2,     :ACCT_A, :ADMIN_A, 'Dlr A2',   'Dealer A2',      '3000000005', 3),
  (:DLR_ORPHAN, :ACCT_A, :ADMIN_A, 'Dlr Orph', 'Dealer Orphan',  '3000000006', 3),
  (:DIST_B1,    :ACCT_B, :ADMIN_B, 'Dist B1',  'Distributor B1', '4000000001', 1);

-- parent_id is a separate UPDATE: is_legal_customer_parent runs on the write
-- and needs both rows to exist first.
UPDATE public.contacts SET parent_id = :DIST_A1 WHERE id = :STK_A1;
UPDATE public.contacts SET parent_id = :STK_A1  WHERE id = :DLR_A1;
UPDATE public.contacts SET parent_id = :DIST_A2 WHERE id = :DLR_A2;

-- The logins, written as the SERVICE role: that is the portal-access route's
-- own path and the only path Task 2's column guard allows.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_A1, portal_email = 'dist-a1@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_A1;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_A2, portal_email = 'dist-a2@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_A2;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_B1, portal_email = 'dist-b1@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_B1;
RESET ROLE;

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT qa('N1 the portal fixture loaded',
  (SELECT count(*) FROM public.contacts WHERE id IN
     (:DIST_A1,:DIST_A2,:STK_A1,:DLR_A1,:DLR_A2,:DLR_ORPHAN,:DIST_B1)) = 7,
  'expected 7 customers in the portal fixture');

SELECT qa('N2 three logins exist and not one of them is a profile',
  (SELECT count(*) FROM public.contacts WHERE portal_user_id IN
     (:PORTAL_U_A1,:PORTAL_U_A2,:PORTAL_U_B1)) = 3
  AND (SELECT count(*) FROM public.profiles WHERE user_id IN
     (:PORTAL_U_A1,:PORTAL_U_A2,:PORTAL_U_B1)) = 0,
  'a portal customer must be an auth.users row and NOTHING else');

SELECT qa('N3 the tree is shaped as the comment says',
  (SELECT parent_id FROM public.contacts WHERE id = :STK_A1) = :DIST_A1::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_A1) = :STK_A1::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_A2) = :DIST_A2::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_ORPHAN) IS NULL,
  'every later section reads this shape');

-- ── O: with the full `authenticated` grant set and no profile, read nothing ──
-- This is the baseline the whole design rests on. If any of these returns a
-- row, the model is broken and the fix is not a new function — it is the policy
-- that leaked.
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('O1 a portal login reads no customers at all',
  (SELECT count(*) FROM public.contacts) = 0,
  'saw ' || (SELECT count(*) FROM public.contacts)::text || ' contacts; expected 0');

SELECT qa('O2 ... no orders',
  (SELECT count(*) FROM public.orders) = 0,
  'saw ' || (SELECT count(*) FROM public.orders)::text);

SELECT qa('O3 ... no payments',
  (SELECT count(*) FROM public.payments) = 0,
  'saw ' || (SELECT count(*) FROM public.payments)::text);

SELECT qa('O4 ... no products',
  (SELECT count(*) FROM public.products) = 0,
  'saw ' || (SELECT count(*) FROM public.products)::text);

SELECT qa('O5 ... no accounts',
  (SELECT count(*) FROM public.accounts) = 0,
  'saw ' || (SELECT count(*) FROM public.accounts)::text);

SELECT qa('O6 ... no profiles, so no employee of any company',
  (SELECT count(*) FROM public.profiles) = 0,
  'saw ' || (SELECT count(*) FROM public.profiles)::text);

SELECT qa('O7 ... no announcements',
  (SELECT count(*) FROM public.tenant_announcements) = 0,
  'saw ' || (SELECT count(*) FROM public.tenant_announcements)::text);

SELECT qa('O8 ... not even its own customer row',
  (SELECT count(*) FROM public.contacts WHERE id = :DIST_A1) = 0,
  'the portal reads its own record through portal_me(), never from the table');

SELECT qa_refused('O9 a portal login cannot insert a customer',
  'INSERT INTO public.contacts (account_id, user_id, name, phone) VALUES ('
  || quote_literal(:ACCT_A) || ', ' || quote_literal(:PORTAL_U_A1)
  || ', ''Portal wrote this'', ''3999999999'')');

SELECT qa_refused('O10 a portal login cannot update its own customer row',
  'UPDATE public.contacts SET name = ''Renamed by the portal'' WHERE id = '
  || quote_literal(:DIST_A1));

RESET ROLE;
```

- [ ] **Step 2: Add the file to the runner**

In `scripts/run-db-tests.sh`, extend the scenario list so it reads:

```sh
for f in 00_fixture 10_buying_status 20_mapping_codes_territory \
         30_territory_coverage_rls 40_area_channel_mapping 50_rights_and_many_holders \
         60_dms_foundation 70_portal_visibility; do
```

A file not named here never runs, and the suite still reports green. That is how fifteen route-rights assertions were silently skipped on 2026-11-05.

- [ ] **Step 3: Run the harness and read every line of the result**

Run: `cd /c/Wacrm/wacrm-web && PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh 2>&1 | tail -45`

Expected: 298 migrations, 46 errors, scenario count 184 + 13 = **197**, 0 failed, no `TRUNCATED`.

**If any of O1–O10 fails, STOP and report BLOCKED.** Do not add a filter, do not change a policy, do not continue to Task 4. Name the table, quote the policy that admitted the read:

```sql
select policyname, cmd, qual, with_check from pg_policies
 where schemaname='public' and tablename='<table>';
```

and say in plain English what a distributor of one company could see of another. That would be a live production leak affecting every tenant, with or without the DMS, and it outranks this plan.

- [ ] **Step 4: Enumerate every policy that does not test membership**

A passing O section proves the seven tables the portal will touch are closed. It does not prove the other ~120 are. Run this on the harness cluster and attach the **full** output to the report:

```sql
-- Every policy whose expression never mentions a membership or ownership test.
-- Each one is either genuinely public (a lookup table, a platform-wide
-- announcement) or a hole. The point is to have looked at the whole list.
select tablename, policyname, cmd,
       coalesce(qual, '') || ' | ' || coalesce(with_check, '') as expr
  from pg_policies
 where schemaname = 'public'
   and coalesce(qual, '') || coalesce(with_check, '') not like '%is_account_member%'
   and coalesce(qual, '') || coalesce(with_check, '') not like '%is_superadmin%'
   and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%'
   and coalesce(qual, '') || coalesce(with_check, '') not like '%account_id%'
 order by tablename, policyname;
```

For each row returned, say in one line whether a profile-less authenticated user could read something a distributor should not. Anything you cannot dismiss becomes another **O-section scenario** proving it reads zero rows for `PORTAL_U_A1`. Do not simply paste the rows — the list is the start of the work, not the end of it.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/70_portal_visibility.sql scripts/run-db-tests.sh
git commit -m "Measure what a portal login can read before granting it anything"
```

---

### Task 4: Migration — the one resolver, and who the caller is

Spec §6.1. One zero-argument function underneath everything, because an argument-taking `can_see(contact_id)` called from a policy is a per-row function call and is the difference between a fast screen and a slow one.

Four things in it are load-bearing and must not be "tidied": no arguments; `c.account_id = t.account_id` **inside** the recursion, so a corrupted `parent_id` cannot cross a tenant boundary; the walk starts from `auth.uid()`, so a revoked login yields an empty array; and `depth < 20` as belt and braces, because `is_legal_customer_parent` has already been rebuilt once (`20261104130000`) and production carries drift the migrations folder does not.

**Files:**
- Create: `supabase/migrations/20261108110000_portal_resolver_and_identity.sql`
- Modify: `supabase/tests/70_portal_visibility.sql` (append sections P and S)
- Modify: `docs/RUN-THIS-SQL-dms-plan-2.md` (second block)

**Interfaces:**
- Consumes: `contacts.parent_id`, the six `portal_*` columns, `public.account_has_line(uuid, text)`.
- Produces, all `stable security definer set search_path = ''`, all `GRANT EXECUTE ... TO authenticated, service_role`:
  - `public.portal_caller() RETURNS TABLE (contact_id uuid, account_id uuid)` — zero or one row. The single definition of "who is calling and are they allowed in". Every other portal function calls this; the five-condition test is written **once**.
  - `public.portal_visible_contact_ids() RETURNS uuid[]` — the caller plus every descendant, `'{}'` when there is no caller.
  - `public.portal_me() RETURNS jsonb` — one object: `{ contact_id, account_id, name, company, phone, email, address, city, state, hierarchy_level, credit_limit, outstanding_balance, account_name, currency, timezone }`, or `null` when there is no caller.
  - `public.portal_customers() RETURNS jsonb` — a JSON array of everyone **below** the caller (the caller itself excluded), each `{ id, name, company, phone, city, state, hierarchy_level, parent_id, parent_name, is_active, buying_status, outstanding_balance, credit_limit, has_portal_login }`, ordered by `hierarchy_level` then `name`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261108110000_portal_resolver_and_identity.sql`:

```sql
-- ============================================================
-- The portal's visibility, as functions instead of policies.
--
-- WHY NOT ADD `OR portal_can_see(...)` TO contacts_select. Both earlier drafts
-- proposed exactly that, "additive only". On 2026-11-02 migration
-- 20261102120000 rebuilt contacts_select and silently dropped three branches:
-- collaborator_ids (so "Also Assigned To" granted nothing), employee_id (direct
-- assignment — the very bug 20261005160000 had been written to close) and
-- data_scope_extends. That was a careful engineer editing one policy
-- deliberately, and three things broke quietly. contacts_select guards every
-- customer record of every tenant. It is not being reopened to let an outsider
-- in.
--
-- So a portal login gets EXECUTE on a named list of functions, and the policies
-- are untouched. A wrong query, a missing filter or an injection in the portal
-- app has no table to reach, because is_account_member is false for a customer
-- with no profiles row (measured in supabase/tests/70_portal_visibility.sql,
-- section O).
--
-- FOUR THINGS IN THE RESOLVER ARE LOAD-BEARING:
--  1. No arguments, so Postgres evaluates it ONCE per statement instead of once
--     per row. An argument-taking can_see(contact_id) is the difference between
--     a fast screen and a slow one.
--  2. c.account_id = t.account_id INSIDE the recursion, so a corrupted
--     parent_id cannot cross a tenant boundary.
--  3. The walk starts from auth.uid(), so a revoked login yields '{}' on the
--     very next request — we do not depend on ending their session.
--  4. depth < 20. is_legal_customer_parent already refuses "X supplied through
--     themselves", but that guard has been rebuilt once (20261104130000) and
--     production carries drift this folder does not. array_agg is DISTINCT so a
--     cycle cannot inflate the array either.
--
-- An UNMAPPED dealer has no parent and therefore appears in nobody's portal.
-- That is the honest answer and it matches the mapping screen, which leaves a
-- customer unmapped when an area has several holders rather than guessing.
-- ============================================================

-- ── Who is calling? Written ONCE. ────────────────────────────
-- The five conditions that make a portal login valid live here and nowhere
-- else. contacts_select drifted because the same rule was written in several
-- branches of one policy; this is the same mistake one layer up, avoided.
--
-- Note what is deliberately NOT tested: is_active and buying_status. The
-- founder ruled on 2026-11-07 that a deactivated or blacklisted customer KEEPS
-- a working login and keeps consuming a seat, because portal access is governed
-- by ONE explicit control — the Provide DMS Access toggle. Do not "fix" this.
CREATE OR REPLACE FUNCTION public.portal_caller()
RETURNS TABLE (contact_id uuid, account_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select c.id, c.account_id
    from public.contacts c
   where c.portal_user_id = (select auth.uid())
     and c.portal_access
     and c.portal_access_revoked_at is null
     and public.account_has_line(c.account_id, 'dms')
   limit 1;
$$;

ALTER FUNCTION public.portal_caller() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_caller() TO authenticated, service_role;

-- ── The resolver ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_visible_contact_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  with recursive me as (
    select contact_id as id, account_id from public.portal_caller()
  ),
  tree as (
    select id, account_id, 0 as depth from me
    union all
    select c.id, c.account_id, t.depth + 1
      from public.contacts c
      join tree t on c.parent_id = t.id
     where t.depth < 20
       and c.account_id = t.account_id
  )
  select coalesce(array_agg(distinct id), '{}'::uuid[]) from tree;
$fn$;

ALTER FUNCTION public.portal_visible_contact_ids() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_visible_contact_ids() TO authenticated, service_role;

-- ── Their own record ─────────────────────────────────────────
-- Returns ONE jsonb object so the portal app reads a shape, not a row type that
-- a later ALTER could reorder. `null` means "you have no portal access", which
-- the app turns into the plain sentence spec §12 asks for.
CREATE OR REPLACE FUNCTION public.portal_me()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select jsonb_build_object(
           'contact_id',          c.id,
           'account_id',          c.account_id,
           'name',                c.name,
           'company',             c.company,
           'phone',               c.phone,
           'email',               c.email,
           'address',             c.address,
           'city',                c.city,
           'state',               c.state,
           'hierarchy_level',     c.hierarchy_level,
           'credit_limit',        c.credit_limit,
           'outstanding_balance', c.outstanding_balance,
           'account_name',        a.name,
           'currency',            coalesce(a.default_currency, 'INR'),
           'timezone',            coalesce(a.settings -> 'company_profile' ->> 'timezone', 'Asia/Kolkata')
         )
    from public.portal_caller() pc
    join public.contacts c on c.id = pc.contact_id
    join public.accounts a on a.id = pc.account_id;
$$;

ALTER FUNCTION public.portal_me() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_me() TO authenticated, service_role;

-- ── Everyone below them ──────────────────────────────────────
-- The CALLER is excluded: this answers "My Customers", and a distributor is not
-- one of their own customers. has_portal_login is a boolean only — the portal
-- never sees another customer's login address.
CREATE OR REPLACE FUNCTION public.portal_customers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select coalesce(jsonb_agg(x order by x ->> 'hierarchy_level', x ->> 'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',                  c.id,
               'name',                c.name,
               'company',             c.company,
               'phone',               c.phone,
               'city',                c.city,
               'state',               c.state,
               'hierarchy_level',     c.hierarchy_level,
               'parent_id',           c.parent_id,
               'parent_name',         p.name,
               'is_active',           c.is_active,
               'buying_status',       c.buying_status,
               'outstanding_balance', c.outstanding_balance,
               'credit_limit',        c.credit_limit,
               'has_portal_login',    (c.portal_user_id is not null
                                        and c.portal_access
                                        and c.portal_access_revoked_at is null)
             ) as x
        from public.contacts c
        left join public.contacts p on p.id = c.parent_id
       where c.id = any(public.portal_visible_contact_ids())
         and c.id is distinct from (select contact_id from public.portal_caller())
    ) s;
$$;

ALTER FUNCTION public.portal_customers() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_customers() TO authenticated, service_role;
```

- [ ] **Step 2: Append section P to the visibility test file**

These are spec §15's tests 1, 2, 3 and 4. Each is written so that deleting the rule it guards makes it fail, and the comment says which rule.

```sql
-- ── P: the resolver ──────────────────────────────────────────
-- Deleting the account check inside the recursion must make P7 fail.
-- Deleting the portal_access / revoked_at conditions must make P8/P9 fail.
-- Deleting the caller-exclusion in portal_customers must make P4 fail.

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('P1 a distributor sees itself plus its whole sub-tree',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 3,
  'DIST_A1 + STK_A1 + DLR_A1 = 3, saw '
  || (SELECT count(*) FROM unnest(public.portal_visible_contact_ids()))::text);

SELECT qa('P2 and the three are exactly the right three',
  public.portal_visible_contact_ids() @> ARRAY[:DIST_A1::uuid, :STK_A1::uuid, :DLR_A1::uuid]
  AND NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_A2::uuid, :DLR_A2::uuid, :DLR_ORPHAN::uuid, :DIST_B1::uuid]),
  'spec §15 test 2: nothing of the distributor beside them');

SELECT qa('P3 portal_me returns their own record',
  public.portal_me() ->> 'contact_id' = trim(both '''' from :'DIST_A1')
  AND public.portal_me() ->> 'company' = 'Distributor A1',
  'saw ' || coalesce(public.portal_me() ->> 'company', 'NULL'));

SELECT qa('P4 My Customers excludes the distributor itself',
  jsonb_array_length(public.portal_customers()) = 2
  AND public.portal_customers()::text NOT LIKE '%Distributor A1%',
  'expected STK_A1 and DLR_A1 only, saw '
  || jsonb_array_length(public.portal_customers())::text);

SELECT qa('P5 another customer''s login ADDRESS is never returned',
  public.portal_customers()::text NOT LIKE '%@portal.test%',
  'only a has_portal_login boolean may cross into the portal');

-- The stockist in the middle: spec §15 test 3. Give STK_A1 a login of its own.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000a003';
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000a003','stk-a1@portal.test');
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = '00000000-0000-0000-0000-00000000a003',
       portal_email = 'stk-a1@portal.test', portal_access = true WHERE id = :STK_A1;
RESET ROLE;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P6 a stockist sees its own slice and NOTHING above it',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 2
  AND public.portal_visible_contact_ids() @> ARRAY[:STK_A1::uuid, :DLR_A1::uuid]
  AND NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_A1::uuid]),
  'spec §15 test 3: the tree walks DOWN only');

-- P7: the tenant boundary inside the recursion. Force a cross-tenant parent_id
-- past is_legal_customer_parent, as the service role, exactly the corruption
-- the account check exists for. Production carries drift this folder does not.
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET parent_id = :STK_A1 WHERE id = :DIST_B1;
RESET ROLE;
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P7 a corrupted parent_id cannot pull another TENANT''s customer in',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_B1::uuid]),
  'this is why c.account_id = t.account_id sits INSIDE the recursion');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET parent_id = NULL WHERE id = :DIST_B1;
RESET ROLE;

-- P8/P9: spec §15 test 4 — a revoked login reads nothing, and its seat is free.
SELECT set_config('test.uid', :ADMIN_A, false);
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :STK_A1;
RESET ROLE;
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P8 a revoked login resolves to nothing at all',
  public.portal_visible_contact_ids() = '{}'::uuid[]
  AND public.portal_me() IS NULL
  AND public.portal_customers() = '[]'::jsonb,
  'the walk starts at auth.uid(), so revoking ends access on the NEXT request');
RESET ROLE;
SELECT qa('P9 and the seat went back to the pool',
  public.portal_seats_used(:ACCT_A) = 2,
  'DIST_A1 and DIST_A2 hold one each; STK_A1''s is released. saw '
  || public.portal_seats_used(:ACCT_A)::text);

-- P10: spec §15 test 7 — take the add-on away and every login stops at once,
-- with nothing deleted. This is also §12's last row.
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.accounts SET addon_lines = '{}' WHERE id = :ACCT_A;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('P10 removing the add-on stops every portal login immediately',
  public.portal_me() IS NULL AND public.portal_visible_contact_ids() = '{}'::uuid[],
  'spec §12: nothing is deleted, but nothing is readable either');
RESET ROLE;
SELECT qa('P11 and nothing was deleted',
  (SELECT portal_user_id FROM public.contacts WHERE id = :DIST_A1) = :PORTAL_U_A1::uuid,
  'the link survives so the add-on can be restored');
UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id = :ACCT_A;

-- Restore STK_A1 to no login, so later sections see the documented tree.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = NULL, portal_email = NULL,
       portal_access = false, portal_access_revoked_at = NULL WHERE id = :STK_A1;
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000a003';
```

- [ ] **Step 3: Append section S — the depth cap and the orphan**

```sql
-- ── S: the belt-and-braces guards ────────────────────────────
-- Deleting `where t.depth < 20` must make S1 hang or blow up rather than pass.

-- S1: a deliberate cycle, forced in as the service role past
-- is_legal_customer_parent. DIST_A1 -> STK_A1 -> DLR_A1 -> DIST_A1.
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET parent_id = :DLR_A1 WHERE id = :DIST_A1;
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('S1 a cycle in parent_id terminates and returns each id once',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 3,
  'depth < 20 caps the walk and array_agg(distinct) de-duplicates it; saw '
  || (SELECT count(*) FROM unnest(public.portal_visible_contact_ids()))::text);
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET parent_id = NULL WHERE id = :DIST_A1;
RESET ROLE;

-- S2: the unmapped dealer is in nobody's portal. Not an error, just absent —
-- spec §6.1 and §12.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('S2 an unmapped dealer appears in NO portal',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DLR_ORPHAN::uuid]),
  'an area with several holders leaves a dealer unmapped until an admin picks one');
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;
SELECT qa('S2b ... including the distributor beside them',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DLR_ORPHAN::uuid]),
  'DIST_A2 must not see it either');

-- S3: an EMPLOYEE calling a portal function gets nothing. The portal functions
-- are definer, so this is the only thing stopping an ordinary staff member
-- reading through them as if they were a distributor.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET ROLE authenticated;
SELECT qa('S3 an employee of the same company resolves to nothing',
  public.portal_visible_contact_ids() = '{}'::uuid[] AND public.portal_me() IS NULL,
  'an employee has no portal_user_id, so portal_caller() returns no row');

-- S4: an employee of the OTHER tenant, likewise.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_B, false);
SET ROLE authenticated;
SELECT qa('S4 an employee of another company resolves to nothing either',
  public.portal_visible_contact_ids() = '{}'::uuid[],
  'spec §15 test 1');

-- S5: anon — nobody signed in at all.
RESET ROLE;
SELECT set_config('test.uid', '', false);
SET ROLE anon;
SELECT qa('S5 a visitor who is not signed in resolves to nothing',
  public.portal_visible_contact_ids() = '{}'::uuid[],
  'auth.uid() is null, so the walk has no root');
RESET ROLE;

-- S6: the H7 limitation, restated here so Plan 2 cannot lose it. With order
-- hierarchy ON, migration 076 refuses any update to a level-less customer, so
-- that customer cannot be given a login. This contradicts founder decision 3
-- ("any customer at any level may have a login") and is in spec §17. The
-- scenario is written to PASS while refused and to FAIL the day it becomes
-- possible, so the limitation cannot vanish quietly.
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'true'::jsonb, true) WHERE id = :ACCT_A;
SET LOCAL ROLE service_role;
UPDATE public.contacts SET hierarchy_level = NULL WHERE id = :DLR_ORPHAN;
SELECT qa_refused('S6 a customer with no Customer Level cannot be given a login (migration 076)',
  'UPDATE public.contacts SET portal_email = ''orph@abc.com'', portal_access = true'
  || ' WHERE id = ' || quote_literal(:DLR_ORPHAN));
UPDATE public.contacts SET hierarchy_level = 3 WHERE id = :DLR_ORPHAN;
RESET ROLE;
UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'false'::jsonb, true) WHERE id = :ACCT_A;
```

- [ ] **Step 4: Run the harness**

Run: `cd /c/Wacrm/wacrm-web && PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh 2>&1 | tail -50`

Expected: `299 migrations applied, 46 reported errors`. Scenario count 197 + 18 = **215**, 0 failed, no `TRUNCATED`.

- [ ] **Step 5: Prove the three load-bearing lines are load-bearing**

Measure, do not reason. Three edits, three runs, restore after each:

1. Remove `and c.account_id = t.account_id` from the recursion → **P7 must fail**.
2. Remove `and c.portal_access and c.portal_access_revoked_at is null` from `portal_caller()` → **P8 must fail**.
3. Remove `where t.depth < 20` → **S1 must fail or the run must hang**. If it hangs, kill it, say so, and restore; a hang is the correct answer and is the evidence.

Report all three results. Also report what happened when you removed `public.account_has_line(c.account_id, 'dms')` from `portal_caller()` → **P10 must fail**.

- [ ] **Step 6: Check the plan for the resolver, and say what it is**

A portal screen calls these on every page load, so the shape of the plan matters. On the harness, as `PORTAL_U_A1`:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT public.portal_visible_contact_ids();
EXPLAIN (ANALYZE, BUFFERS) SELECT public.portal_customers();
```

Record the timings. The fixture is tiny so the numbers prove nothing about scale — what matters is that `portal_caller()`'s probe uses `contacts_portal_user_unique_idx` and not a sequential scan on `contacts`. Confirm that with:

```sql
EXPLAIN SELECT * FROM public.contacts WHERE portal_user_id = '00000000-0000-0000-0000-00000000a001';
```

On a tiny table Postgres may legitimately prefer a seq scan; if it does, say so and note that `SET enable_seqscan = off` shows the index is at least usable. Report what you saw, not what you hoped.

- [ ] **Step 7: Append the second block to the RUN-THIS-SQL document and prove it identical**

Same `cmp` proof as Task 2 Step 6. The plain-English note for this block: "This adds four read-only lookups the distributor portal uses. It changes no existing rule and no existing screen. Nothing about it can be seen by a company that does not have the DMS."

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261108110000_portal_resolver_and_identity.sql supabase/tests/70_portal_visibility.sql docs/RUN-THIS-SQL-dms-plan-2.md
git commit -m "One resolver under the portal: who you are, and who is below you"
```

---

### Task 5: Migration — orders, payments and outstanding, read only

Spec §4 and §6. Four more functions on the same resolver. `purchase` is an order whose customer **is** the caller; `sales` is an order whose customer is somebody below them. Both already exist in the data — the classification is `primary` / `secondary` and `orders.parent_contact_id` snapshots the distributor at order time, so a dealer moving to another distributor does not rewrite last year's history.

Spec §17 question 4 is assumed **no**: a distributor does not see which employee booked a dealer's order, because that names a company employee to an outsider. No salesman field is returned anywhere in this task.

**Files:**
- Create: `supabase/migrations/20261108120000_portal_orders_and_money.sql`
- Modify: `supabase/tests/70_portal_visibility.sql` (append section T)
- Modify: `docs/RUN-THIS-SQL-dms-plan-2.md` (third block)

**Interfaces:**
- Consumes: `public.portal_caller()`, `public.portal_visible_contact_ids()` from Task 4.
- Produces, all `stable security definer set search_path = ''`, granted to `authenticated, service_role`:
  - `public.portal_orders(p_kind text, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 200, p_offset int DEFAULT 0) RETURNS jsonb` — `p_kind` is `'purchase'`, `'sales'` or `'all'`; returns `{ total: int, rows: [ { id, order_number, date, customer_id, customer_name, classification, status, pricing_status, total_amount, item_count, placed_via } ] }`, newest first. `placed_via` is `'portal'` or `'company'`.
  - `public.portal_order_detail(p_order_id uuid) RETURNS jsonb` — one order with its lines, or `null` when the order is not inside the caller's tree. Lines carry `{ product_name, unit, quantity, price, discount_amount, scheme_discount_amount, is_scheme_goods, tax_rate, tax_amount, sub_total, total }`.
  - `public.portal_outstanding() RETURNS jsonb` — `{ mine: numeric, mine_credit_limit: numeric, customers_total: numeric, customers: [ { id, name, company, outstanding_balance, credit_limit } ] }`.
  - `public.portal_payments(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 200, p_offset int DEFAULT 0) RETURNS jsonb` — `{ total, rows: [ { id, payment_number, payment_date, customer_id, customer_name, amount, verified_amount, payment_type, status, reference_number } ] }`, newest first.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261108120000_portal_orders_and_money.sql`. Four functions; the pattern is identical in each, so read the first carefully and follow it.

```sql
-- ============================================================
-- What the distributor can read: their orders, their customers' orders, the
-- money. All read only in v1 (founder decision 6 for payments).
--
-- PURCHASE vs SALES. A purchase order is an order whose customer IS the caller
-- — what they buy from the company, already classification = 'primary'. A sales
-- order is an order whose customer is someone BELOW them, already 'secondary'.
-- They see the ones they placed and the ones the company's reps booked.
--
-- WHAT IS DELIBERATELY NOT RETURNED. No salesman, anywhere. Spec §17 question 4
-- is assumed "no": naming a company employee to an outsider is a decision
-- nobody has taken. placed_via says 'portal' or 'company' and stops there.
-- No margin, no cost, no other customer's price list, no blacklist reason
-- (spec §12: the reason is not shown in the portal).
--
-- DATES ARE ACCOUNT-LOCAL. orders.date and payments.payment_date are DATE
-- columns already recorded in the account's own day, so a date range filters
-- them directly. created_at is timestamptz and is NOT returned: converting it
-- would need AT TIME ZONE the account's timezone, and nothing on these screens
-- needs it.
--
-- EVERY ONE of these starts from portal_visible_contact_ids(), which is '{}'
-- for an employee, for a revoked login, for an account whose add-on was taken
-- away, and for a visitor who is not signed in. `= any('{}')` is false for
-- every row, so each function returns an empty result rather than an error.
-- ============================================================

CREATE OR REPLACE FUNCTION public.portal_orders(
  p_kind   text DEFAULT 'all',
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_me    uuid;
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows  jsonb;
BEGIN
  IF coalesce(p_kind, 'all') NOT IN ('all', 'purchase', 'sales') THEN
    RAISE EXCEPTION 'Unknown order kind. Use purchase, sales or all.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  -- One pass for the count and one for the page. The count is what the screen's
  -- pager needs, and it must agree with the rows, so both read the same WHERE.
  SELECT count(*) INTO v_total
    FROM public.orders o
   WHERE o.contact_id = any(v_ids)
     AND (p_kind = 'all'
       OR (p_kind = 'purchase' AND o.contact_id = v_me)
       OR (p_kind = 'sales'    AND o.contact_id IS DISTINCT FROM v_me))
     AND (p_from IS NULL OR o.date >= p_from)
     AND (p_to   IS NULL OR o.date <= p_to);

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',             o.id,
             'order_number',   o.order_number,
             'date',           o.date,
             'customer_id',    o.contact_id,
             'customer_name',  coalesce(c.company, c.name),
             'classification', o.classification,
             'status',         o.status,
             'pricing_status', o.pricing_status,
             'total_amount',   o.total_amount,
             'item_count',     (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
             'placed_via',     CASE WHEN o.placed_by_portal_contact_id IS NOT NULL
                                    THEN 'portal' ELSE 'company' END
           ) AS x
      FROM public.orders o
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND (p_kind = 'all'
         OR (p_kind = 'purchase' AND o.contact_id = v_me)
         OR (p_kind = 'sales'    AND o.contact_id IS DISTINCT FROM v_me))
       AND (p_from IS NULL OR o.date >= p_from)
       AND (p_to   IS NULL OR o.date <= p_to)
     ORDER BY o.date DESC, o.order_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

ALTER FUNCTION public.portal_orders(text, date, date, int, int) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_orders(text, date, date, int, int) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.portal_order_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select jsonb_build_object(
           'id',             o.id,
           'order_number',   o.order_number,
           'date',           o.date,
           'customer_id',    o.contact_id,
           'customer_name',  coalesce(c.company, c.name),
           'classification', o.classification,
           'status',         o.status,
           'pricing_status', o.pricing_status,
           'notes',          o.notes,
           'sub_total',      o.sub_total,
           'discount_total', o.discount_total,
           'tax_total',      o.tax_total,
           'total_amount',   o.total_amount,
           'placed_via',     case when o.placed_by_portal_contact_id is not null
                                  then 'portal' else 'company' end,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'position',                oi.position,
                      'product_name',            oi.product_name,
                      'unit',                    oi.unit,
                      'quantity',                oi.quantity,
                      'price',                   oi.price,
                      'discount_amount',         oi.discount_amount,
                      'scheme_discount_amount',  oi.scheme_discount_amount,
                      'is_scheme_goods',         oi.is_scheme_goods,
                      'tax_rate',                oi.tax_rate,
                      'tax_amount',              oi.tax_amount,
                      'sub_total',               oi.sub_total,
                      'total',                   oi.total
                    ) order by oi.position), '[]'::jsonb)
               from public.order_items oi where oi.order_id = o.id)
         )
    from public.orders o
    left join public.contacts c on c.id = o.contact_id
   where o.id = p_order_id
     and o.contact_id = any(public.portal_visible_contact_ids());
$$;

ALTER FUNCTION public.portal_order_detail(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_order_detail(uuid) TO authenticated, service_role;


-- `mine` is what the distributor owes the company; `customers` is what their own
-- customers owe them. outstanding_balance is maintained by
-- recalc_contact_outstanding, so this reads a stored number and does not re-add
-- invoices — one authority, as everywhere else in this build.
CREATE OR REPLACE FUNCTION public.portal_outstanding()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  with me as (select contact_id from public.portal_caller()),
  mine as (
    select c.outstanding_balance, c.credit_limit
      from public.contacts c join me on c.id = me.contact_id
  ),
  theirs as (
    select c.id, c.name, c.company, c.outstanding_balance, c.credit_limit
      from public.contacts c
     where c.id = any(public.portal_visible_contact_ids())
       and c.id is distinct from (select contact_id from me)
  )
  select jsonb_build_object(
           'mine',              coalesce((select outstanding_balance from mine), 0),
           'mine_credit_limit', (select credit_limit from mine),
           'customers_total',   coalesce((select sum(outstanding_balance) from theirs), 0),
           'customers', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', t.id, 'name', t.name, 'company', t.company,
                      'outstanding_balance', t.outstanding_balance,
                      'credit_limit', t.credit_limit)
                    order by t.outstanding_balance desc)
               from theirs t), '[]'::jsonb)
         )
    where exists (select 1 from me);
$$;

ALTER FUNCTION public.portal_outstanding() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_outstanding() TO authenticated, service_role;


-- Receipts, read only (founder decision 6). Rejected and cancelled receipts are
-- returned with their status rather than hidden: a distributor who paid and was
-- rejected must be able to see that, or the screen is lying to them.
CREATE OR REPLACE FUNCTION public.portal_payments(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows  jsonb;
BEGIN
  v_ids := public.portal_visible_contact_ids();
  IF v_ids = '{}'::uuid[] THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.payments p
   WHERE p.contact_id = any(v_ids)
     AND (p_from IS NULL OR p.payment_date >= p_from)
     AND (p_to   IS NULL OR p.payment_date <= p_to);

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',               p.id,
             'payment_number',   p.payment_number,
             'payment_date',     p.payment_date,
             'customer_id',      p.contact_id,
             'customer_name',    coalesce(c.company, c.name),
             'amount',           p.amount,
             'verified_amount',  p.verified_amount,
             'payment_type',     p.payment_type,
             'status',           p.status,
             'reference_number', p.reference_number
           ) AS x
      FROM public.payments p
      LEFT JOIN public.contacts c ON c.id = p.contact_id
     WHERE p.contact_id = any(v_ids)
       AND (p_from IS NULL OR p.payment_date >= p_from)
       AND (p_to   IS NULL OR p.payment_date <= p_to)
     ORDER BY p.payment_date DESC, p.payment_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

ALTER FUNCTION public.portal_payments(date, date, int, int) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_payments(date, date, int, int) TO authenticated, service_role;
```

- [ ] **Step 2: Seed orders and payments in the test fixture**

`supabase/tests/00_fixture.sql` deletes all products and orders for both tenants and seeds none, so section T must create its own. Append this to `supabase/tests/70_portal_visibility.sql` **before** the assertions. Write the rows directly rather than through `create_order` — this task is testing the read functions, and `create_order` is Plan 3's subject.

```sql
-- ── T: orders, payments and outstanding ──────────────────────
-- Needs rows of its own: 00_fixture deletes every order and product for both
-- tenants and seeds none.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

\set PROD_A  '''dd000000-0000-0000-0000-0000000000a1'''
\set PROD_B  '''dd000000-0000-0000-0000-0000000000b1'''
\set ORD_P1  '''ee000000-0000-0000-0000-0000000000p1'''
\set ORD_S1  '''ee000000-0000-0000-0000-0000000000s1'''
\set ORD_S2  '''ee000000-0000-0000-0000-0000000000s2'''
\set ORD_X1  '''ee000000-0000-0000-0000-0000000000x1'''
\set ORD_B1  '''ee000000-0000-0000-0000-0000000000b1'''
\set PAY_1   '''ff000000-0000-0000-0000-000000000001'''
\set PAY_2   '''ff000000-0000-0000-0000-000000000002'''
\set PAY_B   '''ff000000-0000-0000-0000-00000000000b'''

DELETE FROM public.order_items WHERE order_id IN (:ORD_P1,:ORD_S1,:ORD_S2,:ORD_X1,:ORD_B1);
DELETE FROM public.orders   WHERE id IN (:ORD_P1,:ORD_S1,:ORD_S2,:ORD_X1,:ORD_B1);
DELETE FROM public.payments WHERE id IN (:PAY_1,:PAY_2,:PAY_B);
DELETE FROM public.products WHERE id IN (:PROD_A,:PROD_B);

INSERT INTO public.products (id, account_id, user_id, name, sku, price, active) VALUES
  (:PROD_A, :ACCT_A, :ADMIN_A, 'Portal Product A', 'PP-A', 100, true),
  (:PROD_B, :ACCT_B, :ADMIN_B, 'Portal Product B', 'PP-B', 100, true);

-- ORD_P1  DIST_A1 buys from the company  -> the caller's PURCHASE
-- ORD_S1  STK_A1 buys from DIST_A1       -> the caller's SALES
-- ORD_S2  DLR_A1 buys, placed VIA THE PORTAL
-- ORD_X1  DLR_A2 buys (under DIST_A2)    -> must be invisible to DIST_A1
-- ORD_B1  DIST_B1, the other tenant      -> must be invisible to everyone in A
INSERT INTO public.orders (id, account_id, user_id, contact_id, date, sub_total, tax_total,
                           total_amount, status, classification, pricing_status,
                           placed_by_portal_contact_id) VALUES
  (:ORD_P1, :ACCT_A, :ADMIN_A, :DIST_A1, CURRENT_DATE - 10, 1000, 0, 1000, 'Pending',   'primary',   'confirmed', NULL),
  (:ORD_S1, :ACCT_A, :ADMIN_A, :STK_A1,  CURRENT_DATE - 5,   500, 0,  500, 'Confirmed', 'secondary', 'confirmed', NULL),
  (:ORD_S2, :ACCT_A, :ADMIN_A, :DLR_A1,  CURRENT_DATE - 1,   250, 0,  250, 'Pending',   'secondary', 'confirmed', :DIST_A1),
  (:ORD_X1, :ACCT_A, :ADMIN_A, :DLR_A2,  CURRENT_DATE - 2,   900, 0,  900, 'Pending',   'secondary', 'confirmed', NULL),
  (:ORD_B1, :ACCT_B, :ADMIN_B, :DIST_B1, CURRENT_DATE - 3,   700, 0,  700, 'Pending',   'primary',   'confirmed', NULL);

INSERT INTO public.order_items (order_id, product_id, product_name, unit, quantity, price,
                                tax_rate, tax_amount, sub_total, total, position) VALUES
  (:ORD_P1, :PROD_A, 'Portal Product A', 'pcs', 10, 100, 0, 0, 1000, 1000, 1),
  (:ORD_S1, :PROD_A, 'Portal Product A', 'pcs',  5, 100, 0, 0,  500,  500, 1),
  (:ORD_S2, :PROD_A, 'Portal Product A', 'pcs',  2, 100, 0, 0,  200,  200, 1),
  (:ORD_S2, :PROD_A, 'Portal Product A', 'pcs',  1,  50, 0, 0,   50,   50, 2),
  (:ORD_X1, :PROD_A, 'Portal Product A', 'pcs',  9, 100, 0, 0,  900,  900, 1),
  (:ORD_B1, :PROD_B, 'Portal Product B', 'pcs',  7, 100, 0, 0,  700,  700, 1);

INSERT INTO public.payments (id, account_id, user_id, contact_id, payment_number, amount,
                             payment_type, payment_date, status) VALUES
  (:PAY_1, :ACCT_A, :ADMIN_A, :DIST_A1, 'PAY-A-1', 400, 'Cash', CURRENT_DATE - 4, 'Approved'),
  (:PAY_2, :ACCT_A, :ADMIN_A, :STK_A1,  'PAY-A-2', 150, 'Cash', CURRENT_DATE - 2, 'Pending'),
  (:PAY_B, :ACCT_B, :ADMIN_B, :DIST_B1, 'PAY-B-1', 300, 'Cash', CURRENT_DATE - 2, 'Approved');
```

- [ ] **Step 3: Write the section T assertions**

```sql
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('T1 purchase orders are the distributor''s own, and only those',
  (public.portal_orders('purchase') ->> 'total')::int = 1
  AND public.portal_orders('purchase') -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_P1'),
  'saw total ' || (public.portal_orders('purchase') ->> 'total'));

SELECT qa('T2 sales orders are their customers'', newest first',
  (public.portal_orders('sales') ->> 'total')::int = 2
  AND public.portal_orders('sales') -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_S2'),
  'ORD_S2 is 1 day old and ORD_S1 is 5; newest must lead');

SELECT qa('T3 the distributor beside them is invisible',
  public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_X1') || '%',
  'spec §15 test 2 — DLR_A2 sits under DIST_A2');

SELECT qa('T4 the other TENANT is invisible',
  public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_B1') || '%'
  AND public.portal_payments()::text NOT LIKE '%PAY-B-1%',
  'spec §15 test 1');

SELECT qa('T5 placed_via distinguishes a portal order from a company one',
  (SELECT x ->> 'placed_via' FROM jsonb_array_elements(public.portal_orders('sales') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S2')) = 'portal'
  AND (SELECT x ->> 'placed_via' FROM jsonb_array_elements(public.portal_orders('sales') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S1')) = 'company',
  'the column exists so a portal order is never a blank salesman');

SELECT qa('T6 NO salesman is returned anywhere',
  public.portal_orders('all')::text NOT LIKE '%salesman%'
  AND public.portal_orders('all')::text NOT LIKE '%user_id%'
  AND coalesce(public.portal_order_detail(:ORD_S1)::text, '') NOT LIKE '%salesman%',
  'spec §17 q4 is assumed NO: an outsider is not told an employee''s name');

SELECT qa('T7 an order detail inside the tree opens, with its lines',
  public.portal_order_detail(:ORD_S2) ->> 'order_number' IS NOT NULL
  AND jsonb_array_length(public.portal_order_detail(:ORD_S2) -> 'lines') = 2,
  'ORD_S2 has two lines');

SELECT qa('T8 an order OUTSIDE the tree returns null, not an error',
  public.portal_order_detail(:ORD_X1) IS NULL
  AND public.portal_order_detail(:ORD_B1) IS NULL,
  'guessing an order id must reveal nothing, and must not look different from a typo');

SELECT qa('T9 a date range filters, and the count agrees with the rows',
  (public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) ->> 'total')::int = 2
  AND jsonb_array_length(public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) -> 'rows') = 2,
  'ORD_S2 (1 day) and ORD_X1 is excluded by the tree, not the date; so S2 + nothing older than 3');

SELECT qa('T10 outstanding splits mine from my customers''',
  (public.portal_outstanding() ->> 'mine') IS NOT NULL
  AND jsonb_array_length(public.portal_outstanding() -> 'customers') = 2,
  'two customers below DIST_A1');

SELECT qa('T11 payments are theirs and their customers'', read only',
  (public.portal_payments() ->> 'total')::int = 2
  AND public.portal_payments()::text LIKE '%PAY-A-1%'
  AND public.portal_payments()::text LIKE '%PAY-A-2%',
  'founder decision 6: view only');

SELECT qa_refused('T12 a portal login cannot insert a payment',
  'INSERT INTO public.payments (account_id, user_id, contact_id, payment_number, amount,'
  || ' payment_type, payment_date) VALUES (' || quote_literal(:ACCT_A) || ', '
  || quote_literal(:PORTAL_U_A1) || ', ' || quote_literal(:DIST_A1)
  || ', ''PAY-HACK'', 1, ''Cash'', CURRENT_DATE)');

-- The distributor beside them, from the other side: the mirror of T3.
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;
SELECT qa('T13 the neighbouring distributor sees ITS order and not the first one''s',
  public.portal_orders('all')::text LIKE '%' || trim(both '''' from :'ORD_X1') || '%'
  AND public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_P1') || '%',
  'both directions of spec §15 test 2');

-- An employee, and the other tenant's employee, through the same functions.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_B, false);
SET ROLE authenticated;
SELECT qa('T14 another company''s admin reads nothing through the portal functions',
  (public.portal_orders('all') ->> 'total')::int = 0
  AND (public.portal_payments() ->> 'total')::int = 0
  AND public.portal_outstanding() IS NULL,
  'spec §15 test 1, through the definer functions this time');
RESET ROLE;
```

- [ ] **Step 4: Run the harness**

Run: `cd /c/Wacrm/wacrm-web && PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh 2>&1 | tail -50`

Expected: `300 migrations applied, 46 reported errors`. Scenario count 215 + 14 = **229**, 0 failed, no `TRUNCATED`.

Note on T9: compute the expected number from the fixture rather than copying it. The fixture's dates are relative to `CURRENT_DATE`, and the point of the assertion is that the `total` and the row count agree — if your arithmetic says a different number, fix the assertion and say so in the report.

- [ ] **Step 5: Prove the tree filter is what refuses, not something else**

Replace `o.contact_id = any(v_ids)` with `o.account_id = (select account_id from public.portal_caller())` in `portal_orders`, re-run, and confirm **T3 and T13 fail** while T4 still passes. That distinguishes "the tenant check works" from "the tree check works" — T4 would pass either way, and a plan that only tested T4 would ship a cross-distributor leak inside every tenant. Restore and re-run clean. Report both runs.

- [ ] **Step 6: Append the fourth block to RUN-THIS-SQL and prove it identical**

Plain-English note: "This adds four more read-only lookups: the distributor's own orders, their customers' orders, their receipts and their outstanding. Nothing here can write anything, and nothing here is visible to a company without the DMS."

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261108120000_portal_orders_and_money.sql supabase/tests/70_portal_visibility.sql docs/RUN-THIS-SQL-dms-plan-2.md
git commit -m "The portal can read its orders, its receipts and its outstanding"
```

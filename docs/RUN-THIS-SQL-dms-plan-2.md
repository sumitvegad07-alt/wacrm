# Run this SQL — DMS part 2

This file carries on from `RUN-THIS-SQL-dms-foundation.md`. Run those five
blocks first if you have not already. Run the blocks here in the order they
appear. Every one is safe to run twice.

---

# Run this SQL first — one login per customer, and who may change a login

This closes two gaps left over from the first part, and fixes one sentence that
read badly.

**One login, one customer.** Today the same login could be put on two
customers by mistake. That matters now, because the next step teaches the
database to work out what a customer may see by starting from "which customer
is this login" and walking down their list of customers. Two customers holding
one login would mean two starting points, and one distributor would see another
distributor's business. This block adds an "index" — a rule the database itself
keeps — that simply refuses the second one.

**Only the customer page may change a login.** The login email and the access
switch sit on the customer record. Your own screens write them with the private
server key, which is the right way. But an admin at a customer company could
send a request straight to the database and change the login email shown on the
customer page, while the real sign-in address stayed as it was. The customer
page would then show one address, the distributor would sign in with another,
and nobody could explain the difference. The same door let them point a login
at someone else's login id, or switch access on by hand without going through
the page. This block adds a small lock (a "trigger" — a rule that runs on every
save and can refuse it) which refuses those six fields unless the save comes
from your own server, the SQL editor, or an OZZO superadmin. The customer sees:
"Portal logins are changed on the customer page, not directly. Use Provide DMS
Access."

**And one sentence.** When an account has bought exactly one login, the old
message said "All 1 portal logins are in use." It now says "The only portal
login is in use. Remove access from another customer, or buy more."

Nothing changes for any account that does not have the DMS. Ordinary work on
customers is not affected: renaming a customer, changing an address, the
outstanding recalculation, imports and the customer-code numbering all go
through untouched, because the lock looks only at saves that really change a
login.

**Check this first.** Paste this on its own and run it. It must return **no
rows**. If it returns any, two customers already share one login, and the block
below will not finish until one of them is cleared — send me what it shows.

```sql
-- Must return no rows. If it returns any, two customers share one login and
-- the unique index below will fail until one of them is cleared.
select portal_user_id, count(*)
  from public.contacts
 where portal_user_id is not null
 group by portal_user_id
having count(*) > 1;
```

**Can I run this while people are working?** Yes. Building the new index takes
a brief lock on the customer table that stops saves, but not reads, and on a
few thousand customers it finishes in well under a second. Nobody will notice.

**If it ever blocks something it should not**, switch the lock off with this one
line and tell me:

`DROP TRIGGER trg_guard_contact_portal_columns ON public.contacts;`

Open Supabase → SQL Editor → paste the SQL below, Run.

Source file: `supabase/migrations/20261108100000_portal_columns_guard_and_unique_login.sql`

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

**What you should see.** "Success. No rows returned." Then check it is working:
open a customer who has a DMS login and change their name. It must save. Then
switch their DMS access off and on from the customer page. That must work too.
Both of those go through your own server, which the lock lets through.

**How to undo the whole block**, if ever needed:

```sql
DROP TRIGGER IF EXISTS trg_guard_contact_portal_columns ON public.contacts;
DROP FUNCTION IF EXISTS public.guard_contact_portal_columns();
DROP INDEX IF EXISTS public.contacts_portal_user_unique_idx;
CREATE INDEX IF NOT EXISTS contacts_portal_user_idx
  ON public.contacts (portal_user_id) WHERE portal_user_id IS NOT NULL;
```

The message wording goes back on its own the next time the earlier file is run,
and nothing depends on it.

---

# Run this SQL second — what a customer with a login is allowed to see

Run this after the first one.

This is the heart of the DMS. It teaches the database four read-only lookups
that the portal uses, and **it changes no existing rule and no existing
screen.** Nothing in your CRM behaves differently after running it.

The important decision inside it: a customer with a login is given permission
to run these four lookups and **nothing else**. They cannot read any table
directly — not customers, not orders, not payments, not even their own record.
Everything they see comes back through a lookup that works out, every single
time, who is asking and who sits below them. So if the portal app were ever
broken into, there is no table for it to reach.

The four lookups are:

* **Who am I** — their own record: name, company, phone, their credit limit and
  their outstanding.
* **Who is below me** — every customer under them, however many levels deep.
  A distributor sees their stockists and those stockists' dealers. A stockist
  sees only their own dealers and nothing above them.
* **Which customers can I act for** — the same list, used by every other
  lookup, so the answer can never differ from screen to screen.
* **Who is calling** — the one place that decides whether a login is valid at
  all. It checks four things: the login is attached to a customer, access is
  switched on, it was not withdrawn, and the company still has the DMS.

Three details worth knowing, because they are decisions and not accidents:

1. **Switching access off works immediately.** The next thing they click
   returns nothing. We do not wait for their session to end.
2. **Taking the DMS away from a company stops every one of its logins at
   once**, and deletes nothing — switch the DMS back on and they all work
   again.
3. **A customer who is not mapped to anybody appears in nobody's portal.** That
   is deliberate. When an area has more than one distributor, the mapping screen
   leaves the dealer unmapped until someone chooses — and a guess here would
   show one distributor another's dealer.

A deactivated or blacklisted customer **keeps** a working login and keeps using
a seat. That is your ruling: access is governed by the Provide DMS Access
toggle alone, so there is exactly one switch to look at.

Open Supabase → SQL Editor → paste the SQL below, Run. Safe to run twice.

Source file: `supabase/migrations/20261108110000_portal_resolver_and_identity.sql`

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
--
-- The timezone comes from public.account_timezone(), which is the single source
-- for an account-local day boundary in SQL (20261031120000). The plan's draft
-- read accounts.settings -> 'company_profile' ->> 'timezone' by hand; that path
-- does not exist — the value lives at settings ->> 'timezone' — so every portal
-- screen would have silently shown Asia/Kolkata for an account in another zone,
-- and the rule would have had a second home. Called, never copied.
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
           'timezone',            public.account_timezone(c.account_id)
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

**What you should see.** "Success. No rows returned." Nothing to test in the app
yet — there is no portal app to sign in to until the next part is built. Your
own CRM should behave exactly as before; if anything about customers, orders or
payments looks different, stop and tell me, because that would mean something
was changed that this block was not supposed to touch.

**How to undo it:**

```sql
DROP FUNCTION IF EXISTS public.portal_customers();
DROP FUNCTION IF EXISTS public.portal_me();
DROP FUNCTION IF EXISTS public.portal_visible_contact_ids();
DROP FUNCTION IF EXISTS public.portal_caller();
```

---

# Run this SQL third — their orders, their receipts and their outstanding

Run this after the second one. Four more read-only lookups, on exactly the same
footing: no table access, no existing rule changed, nothing visible to a company
without the DMS.

* **Purchase orders** — what they bought from you. An order whose customer is
  them.
* **Sales orders** — what their own customers bought. Orders belonging to anyone
  below them, whether the distributor placed it through the portal or your own
  salesman booked it.
* **One order in full** — with its lines, quantities, prices, any scheme goods,
  tax and total. Ask for an order that is not theirs and the answer is simply
  empty, which looks the same as a mistyped number — so nobody can go fishing.
* **Receipts and outstanding** — what they owe you, and what each of their
  customers owes them. Read only, as you decided.

Two things it deliberately never returns:

1. **No salesman name, anywhere.** A distributor is outside your company, and
   naming the employee who booked a dealer's order is a decision nobody has
   taken. The screen says an order came in "via the portal" or "from the
   company", and stops there.
2. **No margin and no other customer's prices.** A distributor never sees what
   you make on them, and never sees another customer's rate.

Rejected and cancelled receipts are shown **with their status** rather than
hidden. A distributor who paid and was rejected has to be able to see that, or
the screen is lying to them.

Open Supabase → SQL Editor → paste the SQL below, Run. Safe to run twice.

Source file: `supabase/migrations/20261108120000_portal_orders_and_money.sql`

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

**What you should see.** "Success. No rows returned." Again, nothing changes in
your CRM.

**How to undo it:**

```sql
DROP FUNCTION IF EXISTS public.portal_payments(date, date, int, int);
DROP FUNCTION IF EXISTS public.portal_outstanding();
DROP FUNCTION IF EXISTS public.portal_order_detail(uuid);
DROP FUNCTION IF EXISTS public.portal_orders(text, date, date, int, int);
```

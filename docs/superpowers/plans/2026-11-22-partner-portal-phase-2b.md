# Partner Portal — Phase 2B Implementation Plan: Customers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sales team a Customers module that behaves like the CRM's Contacts — the same fields, the same split between a view page and an edit form, a timeline, and a panel showing what OZZO has actually billed that customer.

**Architecture:** One migration brings `partner_customers` into line with `contacts` (field names included, which are currently backwards), then the screens are built on the table suite and the detail/timeline pattern that Leads already established. The linked-account panel reads `platform_invoices` and `platform_subscriptions` through a server route, gated per right, because those tables have RLS with no policies.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4, `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.107.0, Base UI 1.9, vitest 4.1.9, PostgreSQL 17 (Supabase, Mumbai).

**Spec:** `docs/superpowers/specs/2026-11-20-partner-portal-design.md`
**Phase 2A (live):** `docs/superpowers/plans/2026-11-20-partner-portal-phase-2a.md`

## Global Constraints

- App is `C:\Wacrm\ozzo-partner`, dev port **3300**, live at **https://partner.ozzo.co.in**. Pushing `main` deploys it.
- **Match the CRM, and check rather than assume.** Phase 2A's Leads was rejected for drifting: it invented three fields, dropped collaborators and WhatsApp, and had no view page. Before building a field or a screen, read the CRM's equivalent in `wacrm-web/src` and quote what you found in the code comment.
- Add no new runtime dependency. `lib/dependencies.test.ts` fails the build if a package is imported but not declared — that is there because two Vercel deploys failed on a package resolving from a neighbouring `node_modules`.
- The `service_role` key may appear only in `lib/auth/partner-service.ts` and under `app/api/**`.
- Rights are enforced by RLS and by `requirePartnerRight()` **before** any service client is built. `can()` only hides menu items.
- **Flip `built: true` in `lib/nav.ts` in the same commit that adds a page**, and update `lib/nav.test.ts`. Phase 1 shipped eleven dead menu items because this was missed.
- Every migration carries **the five questions** in its own comments, and a `docs/RUN-THIS-SQL-partner-*.md` generated FROM the migration file — not hand-written beside it. A hand-written copy went stale and shipped a database one table short.
- **At most one foreign key between any pair of tables.**
- Five gates before `main`: `npx tsc --noEmit`, `npx vitest run`, `npx next build`, `bash scripts/run-db-tests.sh` in `wacrm-web`, and opening the screen in a browser. The last one is not optional: every fault the founder has found so far was invisible to the first four.

---

## What the CRM actually has, measured

Read before planning, so the plan argues from the code rather than memory.

**`contacts` system fields** (from the `custom_fields` seed, module `'contact'`):
`name, company, phone, whatsapp, email, address, area, city, state, country, pincode, hierarchy_level`

**The naming is the opposite of leads, and this is the trap.**
`wacrm-web/src/components/ui/data-table/data-table-types.ts` says, in the `systemKey` doc comment:

> *"The customers table is the case that exposed this: its company column has id `"name"` but renders `contact.company`, so it picked up the label for system_key `'name'` — "Contact Person" — and BOTH visible headings read "Contact Person"."*

So in the CRM: **`contacts.name` is the contact PERSON, `contacts.company` is the BUSINESS.** For leads it is the other way round — `leads.name` is the business and `company` is a mirror of it.

`partner_customers` currently has `business_name` and `contact_person`, which matches neither. Task 1 renames them.

**The contact detail view** (`components/contacts/contact-detail-view.tsx`) is tabbed:
`details · tags · notes · financials · custom`, with `ContactFinancials` computing outstanding from orders minus payments.

The portal's equivalent of "financials" is not orders and payments — it is what **OZZO** has billed this customer: their invoices, their renewal date, their proposals. That is the linked-account panel.

---

## File Structure

### `wacrm-web`

| File | Responsibility |
|---|---|
| `supabase/migrations/20261123120000_partner_customers_crm_parity.sql` | Rename the two columns, add the CRM's missing fields, customer timeline support |
| `supabase/migrations/ROLLBACK-partner-customers-parity.md` | How to undo it |
| `docs/RUN-THIS-SQL-partner-customers.md` | Generated FROM the migration, with checks |
| `supabase/tests/83_partner_customers.sql` | Scenarios: scoping, the rename, the account link, convert landing |

### `ozzo-partner`

| File | Responsibility |
|---|---|
| `lib/customers/types.ts` | `Customer`, `CustomerInput`, `ownerName`, `displayName` |
| `lib/customers/columns.tsx` | The Customers table's `ColumnDef[]` |
| `lib/customers/validate.ts` | `validateCustomerInput()`, `stripCustomerColumns()` |
| `app/(portal)/customers/page.tsx`, `customers-client.tsx` | The list |
| `app/(portal)/customers/new/page.tsx`, `customer-form.tsx` | Add |
| `app/(portal)/customers/[id]/page.tsx`, `customer-detail.tsx` | View, with timeline and the account panel |
| `app/(portal)/customers/[id]/edit/page.tsx` | Edit |
| `app/api/customers/route.ts` | Writes |
| `app/api/customers/billing/route.ts` | The linked-account panel's data, from `platform_*` |
| `components/customers/account-panel.tsx` | Renders it |

---

## Task 1: Bring `partner_customers` into line with the CRM

**Files:**
- Create: `wacrm-web/supabase/migrations/20261123120000_partner_customers_crm_parity.sql`
- Create: `wacrm-web/supabase/migrations/ROLLBACK-partner-customers-parity.md`
- Create: `wacrm-web/docs/RUN-THIS-SQL-partner-customers.md` (generated from the migration)
- Create: `wacrm-web/supabase/tests/83_partner_customers.sql`
- Modify: `wacrm-web/scripts/run-db-tests.sh` (the hard-coded scenario list)

**Interfaces:**
- Consumes: `partner_me()`, `partner_has_right()`, `partner_scope_ids()`, `partner_module_activities`, `partner_convert_lead_to_customer`.
- Produces: `partner_customers` with CRM field names and `collaborator_ids`; an updated `partner_convert_lead_to_customer`; `partner_distinct_values` accepting `customer.city|state|area|country|company`.

- [ ] **Step 1: Write the five questions, honestly**

The risky one here is question 2, because this migration RENAMES columns that
existing code reads. Write it out in full:

```
-- 2. Does a touched column appear in a .select() string in either repo?
--    YES — this migration renames two columns that code reads today:
--      business_name -> company
--      contact_person -> name
--    MEASURED on 2026-11-22, not assumed:
--      grep -rn "business_name" ozzo-partner --include=*.ts --include=*.tsx
--        -> no matches at all
--      grep -rn "contact_person" ozzo-partner --include=*.ts --include=*.tsx
--        -> 14 matches, EVERY ONE of them on partner_LEADS (lead-form,
--           leads-client, lead-detail, columns, types, the two lead API
--           routes). partner_leads.contact_person is NOT renamed.
--    So no application code reads either column on partner_customers - the
--    Customers screens do not exist yet. The ONE live reader is
--    public.partner_convert_lead_to_customer, which inserts them by name and
--    is replaced in this same transaction (Step 4).
```

Re-run that grep before applying. If it finds a reader this plan did not
predict, stop and fix the plan rather than the comment.

- [ ] **Step 2: Write the rename and the new fields**

```sql
begin;

-- The CRM's contacts table names these the other way round from leads:
-- `name` is the contact PERSON and `company` is the BUSINESS. Matching it
-- means the Customers screens can be read against the CRM's line for line,
-- which is the whole reason Phase 2A's Leads had to be reworked.
alter table public.partner_customers rename column business_name to company;
alter table public.partner_customers rename column contact_person to name;

alter table public.partner_customers
  add column if not exists whatsapp text,
  add column if not exists address text,
  add column if not exists area text,
  add column if not exists country text,
  add column if not exists pincode text,
  add column if not exists collaborator_ids uuid[] not null default '{}'::uuid[];

create index if not exists ix_partner_customers_collaborators
  on public.partner_customers using gin (collaborator_ids);

-- A customer must have a business name; the contact person is optional,
-- because a shop is often just a shop until somebody asks who runs it.
alter table public.partner_customers alter column company set not null;
```

- [ ] **Step 3: Widen the read policy for collaborators, as leads has**

```sql
drop policy if exists partner_customers_select on public.partner_customers;
create policy partner_customers_select on public.partner_customers
  for select to authenticated
  using (
    public.partner_has_right('view_customers')
    and (
      owner_id in (select public.partner_scope_ids())
      or public.partner_me() = any (collaborator_ids)
    )
  );
```

- [ ] **Step 4: Replace the convert function for the new column names**

The existing one inserts `business_name` and `contact_person`. After the
rename those columns do not exist and every conversion fails. Replace it in
the same transaction, mapping the lead's fields across:

```sql
create or replace function public.partner_convert_lead_to_customer(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead     partner_leads%rowtype;
  v_customer uuid;
  v_me       uuid := partner_me();
begin
  select * into v_lead from partner_leads where id = p_lead_id;
  if not found then
    raise exception 'That lead does not exist, or you cannot see it.'
      using errcode = '42501';
  end if;

  if v_lead.converted_customer_id is not null then
    raise exception 'This lead has already been converted.' using errcode = '23505';
  end if;

  -- A lead's `name` IS the business, so it becomes the customer's `company`.
  -- The lead's contact_person becomes the customer's `name`. Getting this
  -- pair the wrong way round is the single most likely bug in this migration.
  insert into partner_customers (
    company, name, phone, whatsapp, email, address, area, city, state,
    country, pincode, owner_id, collaborator_ids, became_customer_on,
    source_lead_id, notes, created_by
  ) values (
    v_lead.name, v_lead.contact_person, v_lead.phone, v_lead.whatsapp,
    v_lead.email, v_lead.address, v_lead.area, v_lead.city, v_lead.state,
    v_lead.country, v_lead.pincode, v_lead.owner_id, v_lead.collaborator_ids,
    current_date, v_lead.id, v_lead.notes, v_me
  )
  returning id into v_customer;

  update partner_leads
     set converted_customer_id = v_customer,
         converted_at = now(),
         status = coalesce(
           (select name from partner_lead_statuses
             where lower(name) = 'won' and is_active limit 1),
           status),
         updated_at = now()
   where id = p_lead_id;

  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'lead', p_lead_id, 'converted',
          'Converted to customer ' || v_lead.name);

  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'customer', v_customer, 'created',
          'Created by converting the lead ' || v_lead.name);

  return v_customer;
end;
$$;

revoke all on function public.partner_convert_lead_to_customer(uuid) from public, anon;
grant execute on function public.partner_convert_lead_to_customer(uuid) to authenticated;
```

- [ ] **Step 5: Teach `partner_distinct_values` about customers**

The Customers filter row needs the same searchable place dropdowns Leads has.
Add a `p_module = 'customer'` branch with `company, city, state, area,
country`, written as explicit `elsif` branches like the lead branch — not
`format()`. A dynamic version needs four levels of quote escaping to express
an empty string, inside a `security definer` function.

Each branch filters on `owner_id in (select partner_scope_ids())`, so an
executive's city list holds only their own customers' cities.

```sql
commit;
```

- [ ] **Step 6: Generate the paste doc FROM the migration**

```bash
cd C:\Wacrm\wacrm-web
python - <<'PY'
import io
sql = io.open("supabase/migrations/20261123120000_partner_customers_crm_parity.sql", encoding="utf-8").read()
header = open("docs/_partner-customers-header.md", encoding="utf-8").read()
footer = open("docs/_partner-customers-footer.md", encoding="utf-8").read()
io.open("docs/RUN-THIS-SQL-partner-customers.md", "w", encoding="utf-8").write(header + sql + footer)
PY
```

Write the header and footer as those two small files first, so the doc is
always regenerated rather than edited. A hand-edited copy went stale between
Phase 2 and the port and shipped a database one table short.

The footer's checks must include:

```sql
-- The rename landed, and the right way round.
select column_name from information_schema.columns
where table_name = 'partner_customers' and column_name in ('company','name','business_name','contact_person')
order by column_name;
-- Expect exactly: company, name. If business_name or contact_person is
-- still there, the rename did not run.
```

```sql
-- Converting still works after the rename.
select count(*) from pg_proc where proname = 'partner_convert_lead_to_customer';
-- Expect 1. If a lead was converted before this migration, check that
-- customer still reads correctly:
select company, name from public.partner_customers limit 5;
-- `company` must be the business, `name` the person — not the reverse.
```

- [ ] **Step 7: Write the scenarios**

`supabase/tests/83_partner_customers.sql`, following `82_partner_lead_parity.sql`:
its own fixture, `skip_account_provision` on every `auth.users` insert, top-level
`SELECT qa(...)` only, and clean-up in dependency order.

```
C0  the fixture: three executives, two customers
C1  an executive reads only their own customers
C2  a collaborator reads a customer they do not own
C3  and still cannot read the owner's OTHER customers
C4  a collaborator cannot edit it          (prove from outside RLS)
C5  a stranger reads none of them
C6  company is NOT NULL: a customer with no business name is refused
C7  account_id is unique when set: two customers cannot claim one account
C8  converting a lead puts the business in `company` and the person in `name`
C9  converting twice is still refused
C10 partner_distinct_values('customer','city') respects scope
C11 partner_distinct_values('customer','notes') is refused
C12 no pair of partner_ tables has two foreign keys between them
```

C8 is the one that matters most: it is the assertion that catches the
business and the person being swapped, which is the mistake this migration
is most likely to make.

Add `83_partner_customers` to the `for f in …` list in
`scripts/run-db-tests.sh`, after `82_partner_lead_parity`. The list is
hard-coded, not a glob.

- [ ] **Step 8: Run the harness**

Run: `PGPORT=54476 PGDATA_DIR=<scratch>/pgtest-2b bash scripts/run-db-tests.sh`
Expected: `318 migrations applied, 47 reported errors` — a jump in that count
means this migration failed; look for its filename in the error list — and
`All scenarios passed`. 6–20 minutes; run it in the background.

- [ ] **Step 9: Commit, and have the founder apply it**

Do not start Task 3 until he confirms the checks in Step 6 pass, in
particular that `company` holds the business.

---

## Task 2: Customer types, columns and validation

**Files:**
- Create: `lib/customers/types.ts`, `lib/customers/columns.tsx`, `lib/customers/validate.ts`
- Test: `lib/customers/columns.test.ts`, `lib/customers/validate.test.ts`

**Interfaces:**
- Consumes: `ColumnDef<T>`, `Master`.
- Produces:
  - `type Customer` — every column of `partner_customers`, plus `owner?: { full_name } | { full_name }[] | null`
  - `type CustomerInput = { id?: string; company: string; owner_id: string; name?: string; phone?: string; whatsapp?: string; email?: string; gstin?: string; plan?: string; billing_term?: string; became_customer_on?: string | null; account_id?: string | null; collaborator_ids?: string[]; address?: string; area?: string; city?: string; state?: string; country?: string; pincode?: string; notes?: string }`
  - `displayName(c: Customer): string` — the company, because that is what a customer IS
  - `ownerName(c: Customer): string`
  - `customerColumns(): ColumnDef<Customer>[]`
  - `validateCustomerInput(input): { ok: boolean; errors: Record<string,string> }`
  - `stripCustomerColumns<T>(updates: T): Partial<T>`

- [ ] **Step 1: Write the failing validation test**

```ts
import { describe, expect, it } from "vitest";
import { stripCustomerColumns, validateCustomerInput } from "./validate";

const valid = { company: "Shah Traders", owner_id: "11111111-1111-1111-1111-111111111111" };

describe("validateCustomerInput()", () => {
  it("accepts a customer with just a business name and an owner", () => {
    expect(validateCustomerInput(valid)).toEqual({ ok: true, errors: {} });
  });

  it("requires the business name and an owner", () => {
    const { ok, errors } = validateCustomerInput({});
    expect(ok).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(["company", "owner_id"]);
  });

  it("does not require a contact person — a shop is often just a shop", () => {
    expect(validateCustomerInput({ ...valid, name: "" })).toEqual({ ok: true, errors: {} });
  });

  it("rejects an email that is not one, and accepts none at all", () => {
    expect(validateCustomerInput({ ...valid, email: "nope" }).errors.email).toMatch(/valid email/i);
    expect(validateCustomerInput({ ...valid, email: "" })).toEqual({ ok: true, errors: {} });
  });

  it("accepts the ways people write an Indian phone number", () => {
    for (const p of ["9876543210", "+91 98765 43210", "079-2222 3333"]) {
      expect(validateCustomerInput({ ...valid, phone: p }).errors.phone, p).toBeUndefined();
    }
  });

  it("checks a GSTIN's shape when one is given, and allows none", () => {
    // 15 characters: 2 state digits, 10-character PAN, entity digit, Z, check.
    expect(validateCustomerInput({ ...valid, gstin: "24AAACC1206D1ZM" }).errors.gstin).toBeUndefined();
    expect(validateCustomerInput({ ...valid, gstin: "nonsense" }).errors.gstin).toMatch(/GSTIN/i);
    expect(validateCustomerInput({ ...valid, gstin: "" }).errors.gstin).toBeUndefined();
  });

  it("strips the columns a request must never set", () => {
    expect(
      stripCustomerColumns({ company: "A", id: "x", created_by: "y", source_lead_id: "z" }),
    ).toEqual({ company: "A" });
  });
});
```

- [ ] **Step 2: Run it to watch it fail, then write `validate.ts`**

Phone and email rules are the same as `lib/leads/validate.ts` — import the
shared check rather than writing a second copy that can drift. If that means
extracting `isPlausiblePhone` and `isEmail` into `lib/validation/fields.ts`
and having Leads use them too, do that; it is two functions and one import
each.

GSTIN: `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/`, uppercased
before testing. Checking the shape catches a typo; it does not prove the
number is real, and the comment should say so rather than implying it does.

`stripCustomerColumns` forbids `id, created_at, created_by, source_lead_id` —
the last because a customer's origin is set by the convert function, not by
a request.

Run again — expect PASS, seven cases.

- [ ] **Step 3: Write the failing column test**

```ts
import { describe, expect, it } from "vitest";
import { customerColumns } from "./columns";

describe("customerColumns()", () => {
  it("gives every column a unique id", () => {
    const ids = customerColumns().map((c) => c.id);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  it("shows the BUSINESS first, not the contact person", () => {
    // contacts.name is the person and contacts.company is the business in
    // the CRM — the pair that is easiest to get backwards.
    const first = customerColumns()[0];
    expect(first.id).toBe("company");
    expect(first.label).toBe("Company");
  });

  it("labels the person column Contact Person", () => {
    const person = customerColumns().find((c) => c.id === "name")!;
    expect(person.label).toBe("Contact Person");
  });

  it("only asks for distinct values the database will serve", () => {
    const allowed = new Set(["company", "city", "state", "area", "country"]);
    for (const c of customerColumns()) {
      if (c.valueSource?.kind === "distinct") {
        expect(allowed, `${c.id} asks for ${c.valueSource.column}`).toContain(c.valueSource.column);
        expect(c.valueSource.module).toBe("customer");
      }
    }
  });

  it("shows a sensible handful by default and keeps the rest available", () => {
    const cols = customerColumns();
    const shown = cols.filter((c) => c.visibleByDefault !== false);
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(shown.length).toBeLessThanOrEqual(8);
    expect(cols.length).toBeGreaterThan(shown.length);
  });
});
```

- [ ] **Step 4: Write `columns.tsx`, then run the test**

Visible by default: Company, Contact Person, Phone, City, Owner, Customer
since. Available in Manage Columns: WhatsApp, Email, GSTIN, Plan, Billing
term, Address, Area, State, Country, Pincode, Linked account, Record Status.

Expect PASS, five cases.

- [ ] **Step 5: Commit**

```bash
git add lib/customers && git commit -m "feat: customer types, columns and validation"
```

---

## Task 3: The Customers list

**Files:**
- Create: `app/(portal)/customers/page.tsx`, `app/(portal)/customers/customers-client.tsx`
- Modify: `lib/nav.ts` (`/customers` → `built: true`), `lib/nav.test.ts`

**Interfaces:**
- Consumes: `customerColumns()`, `Customer`, `DataTable`, `useTableView`, `matchesColumnFilters`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the server page**

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { can } from "@/lib/auth/rights";
import CustomersClient from "./customers-client";

export default async function CustomersPage() {
  const me = await requirePartnerRight("view_customers");
  return (
    <CustomersClient
      canCreate={can(me.permissions, "create_customers")}
      canEdit={can(me.permissions, "edit_customers")}
      canDelete={can(me.permissions, "delete_customers")}
    />
  );
}
```

- [ ] **Step 2: Write the list client**

Model it on `app/(portal)/leads/leads-client.tsx`: `useTableView("partner_customers_table", { record_status: ["active"] })`, a search box over company, contact person, phone and email, `unseenModule="customer"`, `rowHref={(c) => \`/customers/${c.id}\`}`, and the same explicit 1,000-row ceiling with its banner.

The read:

```ts
const { data } = await supabase
  .from("partner_customers")
  .select("*, owner:partner_employees!partner_customers_owner_id_fkey(full_name)")
  .order("created_at", { ascending: false })
  .limit(1000);
```

- [ ] **Step 3: Flip the nav flag and update its test**

Set `built: true` on `/customers` in `lib/nav.ts`. In `lib/nav.test.ts`, add
`/customers` to the expected list in "marks exactly the screens that exist as
built", and to the Super Admin and Sales Executive expectations.

- [ ] **Step 4: Gates and commit**

Run: `npx tsc --noEmit && npx vitest run && npx next build` — expect PASS.

---

## Task 4: Add and edit a customer

**Files:**
- Create: `app/(portal)/customers/customer-form.tsx`, `app/(portal)/customers/new/page.tsx`, `app/(portal)/customers/[id]/edit/page.tsx`, `app/api/customers/route.ts`
- Test: `app/api/customers/route-shape.test.ts`

**Interfaces:**
- Consumes: `validateCustomerInput`, `stripCustomerColumns`, `requirePartnerRight`, `serviceClient`, `logPartnerActivity`.
- Produces: `POST /api/customers` → `{ id }`; `PATCH /api/customers` → `{ ok: true }`.

- [ ] **Step 1: Write the form**

Shaped like `app/(portal)/leads/lead-form.tsx`, sections:

- **The business** — Company (required, labelled "Company"), Contact person, Phone, WhatsApp with the `+91` default and the "same as contact number" tickbox, Email
- **The account** — Linked OZZO account (a `SearchableSelect` over `accounts`, see Step 2), Plan, Billing term, GSTIN, Customer since
- **Who else is on it** — collaborator tickboxes, as Leads has
- **Where they are** — Address, Area, City, State, Country, Pincode, the four place fields as `SearchableSelect` over `partner_distinct_values('customer', …)`
- **Notes**

No "Status" equivalent: a customer has no stage.

- [ ] **Step 2: Serve the account list**

The linked-account dropdown needs `accounts`, which the portal's anon key
cannot read. Add `GET /api/customers/accounts` returning `{ id, name,
customer_id }` for every account, gated on `requirePartnerRight("edit_customers")`
before `serviceClient()`.

Mark accounts already linked to another customer so the dropdown can show
them as taken rather than letting the save fail on the unique index.

- [ ] **Step 3: Write the API route**

`POST` gated on `create_customers`, `PATCH` on `edit_customers`, no `DELETE`.
Both strip privilege columns and log to the timeline, as `app/api/leads/route.ts`
does. `23505` on `account_id` means that account already belongs to another
customer — say that, rather than passing the raw constraint name through.

- [ ] **Step 4: Write the route-shape guard**

Modelled on `app/api/leads/route-shape.test.ts`: the right is checked before
`serviceClient(` in every handler, `POST`/`PATCH` are gated on the right
rights, privilege columns are stripped, there is no `DELETE`, and the
duplicate-account error is translated. Break the guard order once to watch it
fail, then revert.

- [ ] **Step 5: Gates and commit**

---

## Task 5: The customer page, with timeline and what OZZO has billed

**Files:**
- Create: `app/(portal)/customers/[id]/page.tsx`, `app/(portal)/customers/[id]/customer-detail.tsx`
- Create: `components/customers/account-panel.tsx`, `app/api/customers/billing/route.ts`
- Test: `app/api/customers/billing/route-shape.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `TimelineEntry`, `logPartnerActivity`, `requirePartnerRight`, `serviceClient`.
- Produces: `GET /api/customers/billing?account_id=…` → `{ invoices: { invoice_no, invoice_date, total, status }[]; subscription: { plan, period_end, status } | null; proposals: { id, title, created_at }[]; allowed: { invoices: boolean; renewals: boolean; proposals: boolean } }`

- [ ] **Step 1: Write the billing route**

This is the only place in Phase 2B that touches `platform_*`, and those
tables have RLS enabled with **no policies** — a server route with the
service client is the only way to read them.

Gate each section on its own right and return `allowed` so the panel can say
"you do not have access to invoices" rather than silently showing nothing:

```ts
const me = await requirePartner();
const allowed = {
  invoices: can(me.permissions, "view_invoices"),
  renewals: can(me.permissions, "view_renewals"),
  proposals: can(me.permissions, "view_proposals"),
};
// Only now, and only for the sections allowed:
const admin = serviceClient();
```

Return empty arrays for sections the caller may not see. Never fetch them at
all — a section that is fetched and then filtered in the browser has already
been sent.

- [ ] **Step 2: Write its guard test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "app", "api", "customers", "billing", "route.ts"),
  "utf8",
);

describe("the customer billing route", () => {
  it("identifies the caller before it builds a service client", () => {
    const guard = src.indexOf("requirePartner");
    const service = src.indexOf("serviceClient(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(service);
  });

  it("decides what is allowed before it fetches anything", () => {
    // Fetching first and filtering afterwards has already sent the data.
    const allowed = src.indexOf("const allowed");
    const firstRead = src.indexOf('.from("platform_');
    expect(allowed).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(-1);
    expect(allowed).toBeLessThan(firstRead);
  });

  it("names all three rights and guards every platform_ read", () => {
    const reads = [...src.matchAll(/\.from\("platform_[a-z_]+"\)/g)].length;
    const guards = [...src.matchAll(/allowed\.(invoices|renewals|proposals)/g)].length;
    expect(reads).toBeGreaterThan(0);
    expect(guards).toBeGreaterThanOrEqual(reads);
    for (const right of ["view_invoices", "view_renewals", "view_proposals"]) {
      expect(src, right).toContain(right);
    }
  });

  it("never writes to a platform_ table", () => {
    // This route reads OZZO's own billing. Nothing here should change it.
    expect(src).not.toMatch(/\.from\("platform_[a-z_]+"\)[\s\S]{0,40}\.(insert|update|delete|upsert)\(/);
  });
});
```

Break the order once — move `const allowed` below the first fetch — to watch
the second test fail, then revert.

- [ ] **Step 3: Write the account panel**

Three small blocks: **Invoices** (number, date, total, status, newest five),
**Renewal** (plan, renews on, days remaining, with the 15-day expiry warning
the CRM uses), **Proposals** (title and date, newest five). Each replaced by
one muted line when `allowed` says no.

When the customer has no `account_id`, the panel is one sentence: "This
customer is not linked to an OZZO account yet, so there is nothing to bill
against. Link it from Edit." That is the common case early on and should not
look like an error.

- [ ] **Step 4: Write the customer page**

Model it on `app/(portal)/leads/[id]/lead-detail.tsx`: header with the
company name and a Converted-from-lead badge where `source_lead_id` is set,
Edit and Call/WhatsApp buttons, a details grid, the timeline, and the account
panel in the right-hand column. Retire / re-activate in the sidebar, gated on
`delete_customers`.

- [ ] **Step 5: Link the lead's "Won" panel to the customer**

`app/(portal)/leads/[id]/lead-detail.tsx` currently says the customer record
"opens from Customers once that screen arrives in the next build." It has
arrived: replace that with a link to `/customers/${lead.converted_customer_id}`.

- [ ] **Step 6: Gates, deploy and SEE IT**

Run the three gates, push, wait for the Vercel deployment to report Ready —
**check that it says Ready, because two deployments have failed silently** —
then open `https://partner.ozzo.co.in/customers` and:

1. Add a customer. It appears in the list.
2. Open it. The details, the timeline entry for its creation, and the account
   panel's "not linked yet" line all show.
3. Edit it and link an OZZO account. The panel fills with real invoices.
4. Convert a lead. The new customer's **Company is the business** and
   **Contact Person is the person** — not swapped.
5. The lead's page now links to the customer.

---

## Phase 2B is done when

1. A customer can be added, edited, filtered, exported, printed, retired and re-activated.
2. Converting a lead creates a customer with the business in Company and the person in Contact Person, and both records link to each other.
3. A linked customer's page shows OZZO's own invoices, renewal date and proposals for that account — and shows nothing at all to somebody without those rights.
4. The customer timeline records creation, edits, retirement and conversion.
5. `npx tsc --noEmit`, `npx vitest run`, `npx next build` pass, the harness reports all scenarios passed with no jump in the migration error count, and the screens have been opened in a browser.

Phase 2C — My Activity — gets its own plan. It is larger than it looks: the
CRM's tasks carry `activity_type`, a five-value status, start and reminder
dates, and a `task_assignees` child table with a per-assignee status and a
rollup trigger. `partner_tasks` as built has none of that and will need the
same parity pass Leads just had.

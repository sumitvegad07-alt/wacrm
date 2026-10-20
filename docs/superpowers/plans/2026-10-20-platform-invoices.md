# Platform Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the founder issue, store, print and track OZZO's own subscription invoices — a full GST tax invoice (CGST/SGST or IGST by place of supply) or a non-GST invoice — from inside the superadmin portal.

**Architecture:** One founder-only table `platform_invoices` with real columns for the list and the books plus a `data` JSONB holding the frozen document, and a one-row `platform_invoice_settings` holding OZZO's seller details. All money, tax, numbering and status rules live in pure functions under `src/lib/invoices/` that import nothing from Supabase, so they are tested without a database. Every read and write goes through `/api/admin/invoices*` behind `requireFounder()` using `serviceClient()`. The PDF is Chrome's own, from an A4 print route.

**Tech Stack:** Next.js 16 App Router (`src/app/`), React 19, TypeScript strict, Supabase/Postgres, Tailwind + shadcn/ui, `sonner` toasts, `lucide-react` icons, vitest (`environment: node`, `renderToStaticMarkup` for component tests).

**Spec:** [`docs/superpowers/specs/2026-10-20-invoice-and-renewal-modules-design.md`](../specs/2026-10-20-invoice-and-renewal-modules-design.md)

## Global Constraints

- **Founder-only, everywhere.** Every API route calls `requireFounder()` from `@/lib/auth/superadmin` before touching `serviceClient()`. Every page calls `requireFounder()` and `notFound()` on throw, matching `src/app/(superadmin)/admin/proposals/page.tsx`. This includes the print route — unlike the tenant print routes, which rely on RLS.
- **New tables have RLS enabled with NO policies**, plus `revoke all ... from anon, authenticated`. Copy the comment discipline of `supabase/migrations/20260926120000_platform_proposals.sql`. Never add a policy "for convenience": it would expose OZZO's own pricing to every signed-in tenant user.
- **Money comes from `quote()` in `@/lib/plans/pricing`.** Never re-derive the term uplifts (quarterly +40%, half-yearly +20%, yearly base) or `TERM_MONTHS` (3 / 6 / 12).
- **The discount is applied ONCE, at invoice level.** Call `quote()` with `discountPct: 0` and `gstRate: 0` — it supplies only the per-user-per-month rate and the gross plan-line amount. The discount and all tax happen in `invoiceTotals()`.
- **GST state logic is reused, not rewritten:** `gstStateCodeFromGstin()`, `determineGstType()`, `gstStateName()`, `GST_STATES` from `@/lib/gst/states`. `GstType` is `'intrastate' | 'interstate' | 'unknown'`.
- **Dates: `todayInIndia()` from `@/lib/proposals/today`.** Vercel runs in UTC. **Never `toISOString()` for a day boundary.** Parse `yyyy-mm-dd` strings by splitting, never by passing them through `Date` (see `src/lib/proposals/ref.ts`).
- **Whole rupees.** Every stored and printed figure is an integer rupee amount. GST is computed once over the taxable value, never per line, so printed rows always add up to the printed total.
- **No `any` without a justifying comment.** TypeScript is strict. Type the database row shapes.
- **Tests live beside the code** as `src/**/*.test.ts(x)` and run with `npm test`. A `*.spec.ts` is NOT picked up by vitest here.
- **Migrations are applied BY HAND by the founder.** The Supabase MCP cannot reach the Mumbai project (permission denied since 2026-10-16). Task 1 ends by handing the SQL over; the screens stay dead until it runs. Do not claim the module works before then.
- **Commit style is this repo's**, not conventional commits: a sentence-case imperative line saying what changed and why it mattered, then a blank line and the body. End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Push to `main` directly.** No branches, no PRs — Vercel deploys `main`.
- **Never expose this to a tenant.** No plan gating entry, no rights-registry entry, no mobile surface, no nav link outside the founder-only list.
- **Report real command output.** Run `npm test`, `npm run typecheck` and `npm run build` and paste what they actually printed.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261020120000_platform_invoices.sql` | Both tables, indexes, delete guard, touch triggers, RLS + revokes |
| `supabase/migrations/ROLLBACK-platform-invoices.md` | The drops, in order |
| `src/lib/invoices/types.ts` | Every type: `InvoiceSeries`, `InvoiceStatus`, `InvoiceLine`, `InvoiceData`, `SellerSnapshot`, `BuyerSnapshot`, `InvoiceRow` |
| `src/lib/invoices/fy.ts` + `.test.ts` | Indian financial year of a date |
| `src/lib/invoices/number.ts` + `.test.ts` | Build / parse the invoice number, and pick the next sequence |
| `src/lib/invoices/tax.ts` + `.test.ts` | Split a taxable value into CGST/SGST or IGST |
| `src/lib/invoices/totals.ts` + `.test.ts` | Line amounts, discount, taxable value, tax, total, amount in words |
| `src/lib/invoices/status.ts` + `.test.ts` | Legal status transitions |
| `src/lib/invoices/denormalise.ts` + `.test.ts` | Payload → the row's denormalised columns |
| `src/app/api/admin/invoice-settings/route.ts` | GET / PUT the single settings row |
| `src/app/api/admin/invoices/route.ts` | GET list, POST create (assigns `seq` + `invoice_no`) |
| `src/app/api/admin/invoices/[id]/route.ts` | GET one, PATCH (draft edit or status change), DELETE (draft only) |
| `src/app/(superadmin)/admin/invoice-settings/page.tsx` | Founder guard |
| `src/app/(superadmin)/admin/invoice-settings/settings-form.tsx` | Seller details + signature upload |
| `src/app/(superadmin)/admin/invoices/page.tsx` | Founder guard |
| `src/app/(superadmin)/admin/invoices/invoices-client.tsx` | The list: DataTable + filter row + footer totals |
| `src/app/(superadmin)/admin/invoices/invoice-form.tsx` | Create / edit form |
| `src/app/(superadmin)/admin/invoices/new/page.tsx` | Founder guard → form in create mode |
| `src/app/(superadmin)/admin/invoices/[id]/page.tsx` | Founder guard → detail |
| `src/app/(superadmin)/admin/invoices/[id]/invoice-detail.tsx` | Detail, status actions, Print, WhatsApp |
| `src/app/(superadmin)/admin/invoices/[id]/edit/page.tsx` | Founder guard → form in edit mode, drafts only |
| `src/lib/invoices/template/invoice-document.tsx` + `.test.tsx` | The A4 document, both variants. Pure props in, markup out — so it is testable |
| `src/app/print/invoice/[id]/page.tsx` | Founder-gated print route |
| `src/app/print/invoice/[id]/download-button.tsx` | `window.print()` button |
| `src/app/(superadmin)/admin/admin-shell.tsx` (modify) | One nav entry |

`src/lib/invoices/*` imports nothing from Supabase on purpose: these are the modules where a mistake prints a wrong tax figure on a filed document, so they must be testable without a database. The document template is a pure component for the same reason.

---

## Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261020120000_platform_invoices.sql`
- Create: `supabase/migrations/ROLLBACK-platform-invoices.md`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.platform_invoices`, `public.platform_invoice_settings`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261020120000_platform_invoices.sql`:

```sql
-- ============================================================
-- platform_invoices — OZZO's own subscription invoices.
--
-- Platform data, not tenant data: no account scoping, RLS enabled with NO
-- policies, and nothing granted to anon/authenticated. Every read and write
-- goes through /api/admin/invoices behind requireFounder(), which then uses the
-- service-role key — the same pattern platform_proposals follows (migration
-- 20260926120000). Consequence: OZZO's billing history is unreachable by any
-- tenant, by a second superadmin, and by a compromised superadmin session.
--
-- The denormalised columns exist so the list, its filters and the outstanding
-- total are ordinary indexed queries. `data` holds the frozen document: seller
-- snapshot, buyer snapshot and line items as they were when the invoice was
-- issued, so a later edit to Invoice Settings or to a tenant's company profile
-- can never change a document that has already gone out.
-- ============================================================

create table if not exists public.platform_invoices (
  id                   uuid primary key default gen_random_uuid(),
  invoice_no           text not null,
  series               text not null default 'gst',
  fy                   text not null,
  seq                  integer not null,
  invoice_date         date not null default current_date,
  -- Nullable, ON DELETE SET NULL: deleting a tenant must never delete the
  -- invoice history that tenant was billed under.
  account_id           uuid references public.accounts(id) on delete set null,
  customer_id          text not null default '',
  client_name          text not null default '',
  plan                 text not null default '',
  billing_term         text not null default 'yearly',
  users_billed         integer not null default 0,
  period_start         date,
  period_end           date,
  gst_enabled          boolean not null default true,
  gst_rate             numeric(5,2) not null default 18,
  gst_type             text,
  place_of_supply_code text,
  subtotal             numeric(12,2) not null default 0,
  discount_amount      numeric(12,2) not null default 0,
  taxable_value        numeric(12,2) not null default 0,
  cgst_amount          numeric(12,2) not null default 0,
  sgst_amount          numeric(12,2) not null default 0,
  igst_amount          numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  amount_received      numeric(12,2) not null default 0,
  status               text not null default 'draft',
  paid_at              date,
  data                 jsonb not null default '{}'::jsonb,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint platform_invoices_series_check
    check (series in ('gst', 'non_gst')),
  constraint platform_invoices_term_check
    check (billing_term in ('quarterly', 'half_yearly', 'yearly')),
  constraint platform_invoices_status_check
    check (status in ('draft', 'issued', 'part_paid', 'paid', 'cancelled')),
  -- gst_type is meaningful only on a GST invoice, and MUST be present on one.
  -- Pairing the two in a single constraint is what stops a non-GST invoice
  -- carrying a stale 'interstate' and a GST invoice carrying none.
  constraint platform_invoices_gst_type_check
    check (
      (gst_enabled and gst_type in ('intrastate', 'interstate', 'unknown'))
      or ((not gst_enabled) and gst_type is null)
    )
);

comment on table public.platform_invoices is
  'OZZO subscription invoices (founder-only). RLS denies all; access via /api/admin/invoices with the service role.';
comment on column public.platform_invoices.data is
  'Frozen document: seller snapshot, buyer snapshot, line items, notes, terms. Written on every save; authoritative for what was printed.';
comment on column public.platform_invoices.seq is
  'Counter within (series, fy). The unique index on (series, fy, seq) is what makes a duplicate number impossible rather than unlikely.';

create unique index if not exists platform_invoices_no_key
  on public.platform_invoices (invoice_no);
create unique index if not exists platform_invoices_series_fy_seq_key
  on public.platform_invoices (series, fy, seq);
create index if not exists platform_invoices_date_idx
  on public.platform_invoices (invoice_date desc);
create index if not exists platform_invoices_status_idx
  on public.platform_invoices (status);
create index if not exists platform_invoices_account_idx
  on public.platform_invoices (account_id);

-- ------------------------------------------------------------
-- Seller details. One row, enforced by the primary key itself: `id` is a
-- boolean constrained to true, so a second row collides on the PK.
-- ------------------------------------------------------------
create table if not exists public.platform_invoice_settings (
  id                      boolean primary key default true,
  firm_name               text not null default '',
  address                 text not null default '',
  pincode                 text not null default '',
  state                   text not null default '',
  gst_state_code          text not null default '',
  gstin                   text not null default '',
  pan                     text not null default '',
  phone                   text not null default '',
  email                   text not null default '',
  bank_name               text not null default '',
  bank_account_no         text not null default '',
  ifsc                    text not null default '',
  upi_id                  text not null default '',
  declaration             text not null default '',
  default_terms           text not null default '',
  signature_url           text,
  logo_url                text,
  -- "Start the series at this number instead of 1." For a financial year in
  -- which invoices were already issued outside the app.
  next_gst_seq_override     integer,
  next_non_gst_seq_override integer,
  updated_at              timestamptz not null default now(),

  constraint platform_invoice_settings_single_row check (id)
);

comment on table public.platform_invoice_settings is
  'OZZO''s own seller details for invoices (founder-only, exactly one row). RLS denies all.';

insert into public.platform_invoice_settings (id)
  values (true)
  on conflict (id) do nothing;

-- ------------------------------------------------------------
-- An issued invoice is cancelled, never deleted: GST requires a consecutive
-- series, and a deleted row leaves a hole in it.
-- ------------------------------------------------------------
create or replace function public.block_issued_invoice_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    raise exception
      'Invoice % is %, not a draft. Cancel it instead — deleting it would leave a gap in the % series.',
      old.invoice_no, old.status, old.series;
  end if;
  return old;
end;
$$;

drop trigger if exists platform_invoices_block_delete on public.platform_invoices;
create trigger platform_invoices_block_delete
  before delete on public.platform_invoices
  for each row execute function public.block_issued_invoice_delete();

create or replace function public.touch_platform_invoices_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_invoices_touch_updated_at on public.platform_invoices;
create trigger platform_invoices_touch_updated_at
  before update on public.platform_invoices
  for each row execute function public.touch_platform_invoices_updated_at();

drop trigger if exists platform_invoice_settings_touch_updated_at on public.platform_invoice_settings;
create trigger platform_invoice_settings_touch_updated_at
  before update on public.platform_invoice_settings
  for each row execute function public.touch_platform_invoices_updated_at();

-- ------------------------------------------------------------
-- RLS on, deliberately no policies. Do not add one.
-- ------------------------------------------------------------
alter table public.platform_invoices enable row level security;
alter table public.platform_invoice_settings enable row level security;

revoke all on public.platform_invoices from anon, authenticated;
revoke all on public.platform_invoice_settings from anon, authenticated;
```

- [ ] **Step 2: Write the rollback note**

Create `supabase/migrations/ROLLBACK-platform-invoices.md`:

````markdown
# Rollback — platform invoices (20261020120000)

Founder-only data. Dropping these tables destroys OZZO's own invoice history,
which is accounting data. Export it first:

```sql
\copy (select * from public.platform_invoices order by series, fy, seq) to 'platform_invoices.csv' csv header
```

Then, in order:

```sql
drop trigger if exists platform_invoices_block_delete on public.platform_invoices;
drop trigger if exists platform_invoices_touch_updated_at on public.platform_invoices;
drop trigger if exists platform_invoice_settings_touch_updated_at on public.platform_invoice_settings;
drop function if exists public.block_issued_invoice_delete();
drop function if exists public.touch_platform_invoices_updated_at();
drop table if exists public.platform_invoice_settings;
drop table if exists public.platform_invoices;
```

`touch_platform_invoices_updated_at()` is used by both tables — drop it only
after both tables are gone.
````

- [ ] **Step 3: Check the SQL parses**

There is no local Postgres in this repo, so the check is a careful read, not a
run. Verify by eye:
- every `create table` has matching parentheses and each `constraint` names a table that exists;
- `accounts` and `auth.users` are the only foreign keys;
- no `create policy` anywhere in the file;
- both `revoke` lines are present.

Do NOT claim the migration has been applied or tested against a database.

- [ ] **Step 4: Commit and hand over**

```bash
git add supabase/migrations/20261020120000_platform_invoices.sql supabase/migrations/ROLLBACK-platform-invoices.md
git commit -m "$(cat <<'EOF'
Add the platform_invoices tables for OZZO's own billing

Two founder-only tables: platform_invoices, with denormalised columns for
the list and a frozen `data` payload for the document, and a one-row
platform_invoice_settings for the seller details. RLS is enabled with no
policies and nothing is granted to anon or authenticated, so the only way
in is the service role behind requireFounder().

A trigger refuses to delete anything but a draft: GST wants a consecutive
number series, and a deleted invoice leaves a hole in it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Then tell the founder, in plain words: this SQL file has to be run by hand on
the Mumbai project before the Invoices screens will load, because the Supabase
MCP connection can no longer reach it. Do not move on claiming the module works.

---

## Task 2: Types and the financial year

**Files:**
- Create: `src/lib/invoices/types.ts`
- Create: `src/lib/invoices/fy.ts`
- Test: `src/lib/invoices/fy.test.ts`

**Interfaces:**
- Consumes: `BillingTerm` from `@/lib/plans/pricing`, `PlanId` from `@/lib/plans/catalog`, `GstType` from `@/lib/gst/states`.
- Produces: `InvoiceSeries`, `InvoiceStatus`, `InvoiceLine`, `SellerSnapshot`, `BuyerSnapshot`, `InvoiceData`, `InvoiceRow`; `financialYear(date: string | Date): string`.

- [ ] **Step 1: Write the types**

Create `src/lib/invoices/types.ts`:

```ts
// ============================================================
// Types for OZZO's own invoices.
//
// A stored invoice is one row in `platform_invoices`: denormalised columns the
// list and the books read, plus `data` — the frozen document. Everything in
// `InvoiceData` is a snapshot taken at save time, never a live lookup, because
// an issued invoice must print the same figures and the same addresses forever.
// ============================================================

import type { BillingTerm } from "@/lib/plans/pricing";
import type { GstType } from "@/lib/gst/states";

export type InvoiceSeries = "gst" | "non_gst";

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "part_paid",
  "paid",
  "cancelled",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Human label, as shown in the list and on the detail screen. */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const SERIES_LABEL: Record<InvoiceSeries, string> = {
  gst: "GST",
  non_gst: "Non-GST",
};

/**
 * One row of the invoice's price table.
 *
 * `users`, `months` and `rate` describe a subscription line and multiply out;
 * a one-off charge (setup, training) sets `users: 1`, `months: 1` and puts the
 * whole charge in `rate`. One shape, so `lineAmount()` has one branch.
 */
export interface InvoiceLine {
  label: string;
  description: string;
  /** SAC code. Defaults to 998314 — IT design and development services. */
  sac: string;
  users: number;
  months: number;
  /** Rupees per user per month for a plan line; the whole charge for a one-off. */
  rate: number;
}

/** OZZO's own details, frozen onto the invoice. */
export interface SellerSnapshot {
  firmName: string;
  address: string;
  pincode: string;
  state: string;
  gstStateCode: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccountNo: string;
  ifsc: string;
  upiId: string;
  declaration: string;
  signatureUrl: string | null;
  logoUrl: string | null;
}

/** The customer's details, frozen onto the invoice. */
export interface BuyerSnapshot {
  name: string;
  address: string;
  pincode: string;
  state: string;
  gstStateCode: string;
  gstin: string;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface InvoiceData {
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  lines: InvoiceLine[];
  /** Percent, 0–100. Zero when a flat amount was entered instead. */
  discountPct: number;
  /** Rupees. Used only when `discountPct` is 0. */
  discountAmount: number;
  notes: string;
  terms: string;
}

/** The row as the API returns it. Numeric columns arrive as numbers. */
export interface InvoiceRow {
  id: string;
  invoice_no: string;
  series: InvoiceSeries;
  fy: string;
  seq: number;
  invoice_date: string;
  account_id: string | null;
  customer_id: string;
  client_name: string;
  plan: string;
  billing_term: BillingTerm;
  users_billed: number;
  period_start: string | null;
  period_end: string | null;
  gst_enabled: boolean;
  gst_rate: number;
  gst_type: GstType | null;
  place_of_supply_code: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total: number;
  amount_received: number;
  status: InvoiceStatus;
  paid_at: string | null;
  data: InvoiceData;
  created_at: string;
  updated_at: string;
}

/** The seller settings row, as the API returns it. */
export interface InvoiceSettingsRow extends Omit<SellerSnapshot, "signatureUrl" | "logoUrl"> {
  signatureUrl: string | null;
  logoUrl: string | null;
  defaultTerms: string;
  nextGstSeqOverride: number | null;
  nextNonGstSeqOverride: number | null;
}

export const DEFAULT_SAC = "998314";
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/invoices/fy.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { financialYear } from "./fy";

// ---------------------------------------------------------------------------
// The Indian financial year starts on 1 April. Every GST invoice number here
// carries it, so an off-by-one at the boundary renumbers a whole year's books.
// ---------------------------------------------------------------------------

describe("financialYear", () => {
  test("a date in April starts the new year", () => {
    expect(financialYear("2026-04-01")).toBe("26-27");
  });

  test("a date in March belongs to the year that began last April", () => {
    expect(financialYear("2027-03-31")).toBe("26-27");
  });

  test("January, February and March all look back", () => {
    expect(financialYear("2027-01-15")).toBe("26-27");
    expect(financialYear("2027-02-28")).toBe("26-27");
  });

  test("the day before the boundary is still the old year", () => {
    expect(financialYear("2026-03-31")).toBe("25-26");
  });

  test("a yyyy-mm-dd string is never passed through Date", () => {
    // 2026-04-01 read as UTC midnight then formatted in a timezone behind UTC
    // would come back as 31 March and answer "25-26".
    expect(financialYear("2026-04-01")).toBe("26-27");
    expect(financialYear("2026-12-31")).toBe("26-27");
  });

  test("a Date object is read in local terms", () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe("26-27"); // month 3 = April
    expect(financialYear(new Date(2026, 2, 31))).toBe("25-26"); // month 2 = March
  });

  test("the century rolls over without a four-digit label", () => {
    expect(financialYear("2099-05-01")).toBe("99-00");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/fy.test.ts`
Expected: FAIL — cannot resolve `./fy`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/invoices/fy.ts`:

```ts
// ============================================================
// The Indian financial year, as an invoice number spells it: "26-27".
//
// Starts 1 April. A yyyy-mm-dd string is SPLIT, never passed through `Date`:
// Vercel runs in UTC, and parsing "2026-04-01" then reading it back in any
// timezone behind UTC gives 31 March — which would renumber the whole year.
// Same reasoning as `src/lib/proposals/ref.ts`.
// ============================================================

function yearMonth(date: string | Date): { year: number; month: number } {
  if (typeof date === "string") {
    const [y, m] = date.split("-");
    return { year: Number(y), month: Number(m) };
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** Two-digit year, so 2026 reads "26" and 2100 reads "00". */
function yy(year: number): string {
  return String(((year % 100) + 100) % 100).padStart(2, "0");
}

/** `financialYear('2026-04-01')` → `'26-27'`; `('2026-03-31')` → `'25-26'`. */
export function financialYear(date: string | Date): string {
  const { year, month } = yearMonth(date);
  const startYear = month >= 4 ? year : year - 1;
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/fy.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/invoices/types.ts src/lib/invoices/fy.ts src/lib/invoices/fy.test.ts
git commit -m "$(cat <<'EOF'
Add the invoice types and the Indian financial year

financialYear() splits a yyyy-mm-dd string rather than passing it through
Date, because Vercel runs in UTC and parsing "2026-04-01" there comes back
as 31 March in any timezone behind it — which would renumber a whole
year's invoices.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Invoice numbering

**Files:**
- Create: `src/lib/invoices/number.ts`
- Test: `src/lib/invoices/number.test.ts`

**Interfaces:**
- Consumes: `InvoiceSeries` from `./types`.
- Produces: `buildInvoiceNo(series: InvoiceSeries, fy: string, seq: number): string`; `parseInvoiceNo(no: string): { series: InvoiceSeries; fy: string; seq: number } | null`; `nextSeq(lastSeq: number | null, override: number | null): number`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/number.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildInvoiceNo, nextSeq, parseInvoiceNo } from "./number";

// ---------------------------------------------------------------------------
// GST wants a consecutive series, unique within a financial year. The two
// series are kept apart by a single letter so a glance at the number says
// which book an invoice belongs in.
// ---------------------------------------------------------------------------

describe("buildInvoiceNo", () => {
  test("a GST invoice is OZZO/<fy>/<3 digits>", () => {
    expect(buildInvoiceNo("gst", "26-27", 1)).toBe("OZZO/26-27/001");
  });

  test("a non-GST invoice carries a B", () => {
    expect(buildInvoiceNo("non_gst", "26-27", 1)).toBe("OZZO/26-27/B001");
  });

  test("padding stops at three digits and then grows", () => {
    expect(buildInvoiceNo("gst", "26-27", 99)).toBe("OZZO/26-27/099");
    expect(buildInvoiceNo("gst", "26-27", 100)).toBe("OZZO/26-27/100");
    expect(buildInvoiceNo("gst", "26-27", 1234)).toBe("OZZO/26-27/1234");
  });

  test("the number stays inside the 16-character GST limit", () => {
    // Rule 46(b): at most 16 characters, alphanumeric plus "-" and "/".
    expect(buildInvoiceNo("non_gst", "26-27", 9999).length).toBeLessThanOrEqual(16);
  });
});

describe("parseInvoiceNo", () => {
  test("round-trips both series", () => {
    expect(parseInvoiceNo("OZZO/26-27/001")).toEqual({ series: "gst", fy: "26-27", seq: 1 });
    expect(parseInvoiceNo("OZZO/26-27/B042")).toEqual({ series: "non_gst", fy: "26-27", seq: 42 });
  });

  test("anything else is null, never a guess", () => {
    expect(parseInvoiceNo("")).toBeNull();
    expect(parseInvoiceNo("INV-1")).toBeNull();
    expect(parseInvoiceNo("OZZO/2026/001")).toBeNull();
    expect(parseInvoiceNo("OZZO/26-27/X001")).toBeNull();
  });
});

describe("nextSeq", () => {
  test("the first invoice of a series is 1", () => {
    expect(nextSeq(null, null)).toBe(1);
    expect(nextSeq(0, null)).toBe(1);
  });

  test("otherwise it follows the last one", () => {
    expect(nextSeq(7, null)).toBe(8);
  });

  test("an override starts the series higher, for books begun outside the app", () => {
    expect(nextSeq(null, 51)).toBe(51);
    expect(nextSeq(3, 51)).toBe(51);
  });

  test("an override already passed is ignored — the series never goes backwards", () => {
    expect(nextSeq(60, 51)).toBe(61);
  });

  test("nonsense never produces a NaN number", () => {
    expect(nextSeq(Number.NaN, null)).toBe(1);
    expect(nextSeq(null, Number.NaN)).toBe(1);
    expect(nextSeq(null, -5)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/number.test.ts`
Expected: FAIL — cannot resolve `./number`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoices/number.ts`:

```ts
// ============================================================
// Invoice numbers: OZZO/26-27/001 for GST, OZZO/26-27/B001 for non-GST.
//
// Two series, each consecutive within its financial year, each restarting at 1
// on 1 April. GST rule 46(b) caps the number at 16 characters and allows only
// alphanumerics, "-" and "/" — which this shape satisfies up to four digits.
//
// The letter B is the whole difference between the two books, so that a number
// read aloud on a phone call says which one it came from.
// ============================================================

import type { InvoiceSeries } from "./types";

const PREFIX: Record<InvoiceSeries, string> = { gst: "", non_gst: "B" };

const PATTERN = /^OZZO\/(\d{2}-\d{2})\/(B?)(\d+)$/;

export function buildInvoiceNo(series: InvoiceSeries, fy: string, seq: number): string {
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  return `OZZO/${fy}/${PREFIX[series]}${String(n).padStart(3, "0")}`;
}

/** The reverse, for reading a number the founder typed. Null when it is not ours. */
export function parseInvoiceNo(
  no: string,
): { series: InvoiceSeries; fy: string; seq: number } | null {
  const match = PATTERN.exec((no ?? "").trim());
  if (!match) return null;

  const [, fy, letter, digits] = match;
  return {
    series: letter === "B" ? "non_gst" : "gst",
    fy,
    seq: Number(digits),
  };
}

/**
 * The next sequence in a series.
 *
 * `override` is the founder's "start this year's book at 51", for a financial
 * year in which he had already issued invoices outside the app. It is honoured
 * only while it is still ahead: once the series has passed it, following the
 * last number is the only safe answer, because going backwards would collide
 * with a number already issued.
 */
export function nextSeq(lastSeq: number | null, override: number | null): number {
  const last = Number.isFinite(Number(lastSeq)) ? Math.max(0, Math.floor(Number(lastSeq))) : 0;
  const start = Number.isFinite(Number(override)) ? Math.floor(Number(override)) : 0;

  if (start > last) return Math.max(1, start);
  return last + 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/number.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoices/number.ts src/lib/invoices/number.test.ts
git commit -m "$(cat <<'EOF'
Add invoice numbering, two series per financial year

OZZO/26-27/001 for GST and OZZO/26-27/B001 for non-GST, both consecutive
within the year and both inside rule 46(b)'s 16 characters. nextSeq()
honours a founder-set starting number only while it is still ahead of the
series: once passed, going backwards would collide with a number already
issued.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The tax split

**Files:**
- Create: `src/lib/invoices/tax.ts`
- Test: `src/lib/invoices/tax.test.ts`

**Interfaces:**
- Consumes: `GstType` from `@/lib/gst/states`.
- Produces: `TaxSplit` (`{ cgst: number; sgst: number; igst: number; total: number }`); `splitTax(taxableValue: number, ratePct: number, gstType: GstType | null): TaxSplit`; `placeOfSupply(buyerGstin: string, buyerStateName: string): string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/tax.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { placeOfSupply, splitTax } from "./tax";

// ---------------------------------------------------------------------------
// The two halves of an intra-state tax MUST be equal — CGST 9% and SGST 9% are
// separate levies at their own rate, not a split of one 18% figure. Computing
// each at its own rate is what keeps them equal AND keeps the printed rows
// adding up to the printed total.
// ---------------------------------------------------------------------------

describe("splitTax", () => {
  test("intra-state charges CGST and SGST at half the rate each", () => {
    expect(splitTax(10000, 18, "intrastate")).toEqual({
      cgst: 900,
      sgst: 900,
      igst: 0,
      total: 1800,
    });
  });

  test("inter-state puts the whole rate in IGST", () => {
    expect(splitTax(10000, 18, "interstate")).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 1800,
      total: 1800,
    });
  });

  test("the two halves stay equal on an awkward amount, and sum to the total", () => {
    const split = splitTax(25005, 18, "intrastate");
    expect(split.cgst).toBe(split.sgst);
    expect(split.cgst + split.sgst).toBe(split.total);
    expect(split.cgst).toBe(2250); // 25005 × 9% = 2250.45 → 2250
  });

  test("an unknown place of supply charges nothing rather than guessing", () => {
    expect(splitTax(10000, 18, "unknown")).toEqual({ cgst: 0, sgst: 0, igst: 0, total: 0 });
    expect(splitTax(10000, 18, null)).toEqual({ cgst: 0, sgst: 0, igst: 0, total: 0 });
  });

  test("a zero rate is a non-GST invoice and produces no tax", () => {
    expect(splitTax(10000, 0, "intrastate").total).toBe(0);
  });

  test("a zero or negative taxable value produces no tax", () => {
    expect(splitTax(0, 18, "interstate").total).toBe(0);
    expect(splitTax(-500, 18, "interstate").total).toBe(0);
  });

  test("every figure is a whole rupee", () => {
    const split = splitTax(1234, 18, "interstate");
    expect(Number.isInteger(split.igst)).toBe(true);
    expect(split.igst).toBe(222); // 1234 × 18% = 222.12
  });

  test("nonsense never produces NaN", () => {
    expect(splitTax(Number.NaN, 18, "interstate").total).toBe(0);
    expect(splitTax(10000, Number.NaN, "interstate").total).toBe(0);
  });
});

describe("placeOfSupply", () => {
  test("a registered buyer's GSTIN decides it", () => {
    expect(placeOfSupply("24AAAAA0000A1Z5", "Maharashtra")).toBe("24");
  });

  test("an unregistered buyer falls back to the state picked", () => {
    expect(placeOfSupply("", "Gujarat")).toBe("24");
  });

  test("neither one gives null, so the caller must refuse to issue", () => {
    expect(placeOfSupply("", "")).toBeNull();
    expect(placeOfSupply("  ", "Not A State")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/tax.test.ts`
Expected: FAIL — cannot resolve `./tax`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoices/tax.ts`:

```ts
// ============================================================
// Splitting an invoice's taxable value into CGST + SGST or IGST.
//
// The intra/inter-state RULE is not reimplemented here: `determineGstType()` in
// lib/gst/states.ts already owns it, and is the TS mirror of the SQL
// `gst_state_code()` the tenant Orders module persists with. This file only
// does the arithmetic.
//
// CGST and SGST are each computed at HALF the rate, not as a split of the whole
// tax. They are separate levies at their own rate, so they must print as equal
// figures; halving a single rounded total would make them differ by a rupee on
// an odd amount. The side-effect is that an intra-state invoice can total one
// rupee away from an inter-state one at the same rate. That is correct, and it
// is why the rows always add up to the printed total.
// ============================================================

import { GST_STATES, gstStateCode, gstStateCodeFromGstin } from "@/lib/gst/states";
import type { GstType } from "@/lib/gst/states";

export interface TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
  /** cgst + sgst + igst. Always one or the other pair, never both. */
  total: number;
}

const ZERO: TaxSplit = { cgst: 0, sgst: 0, igst: 0, total: 0 };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function splitTax(
  taxableValue: number,
  ratePct: number,
  gstType: GstType | null,
): TaxSplit {
  const base = num(taxableValue);
  const rate = num(ratePct);

  // 'unknown' means the place of supply could not be determined. Charging
  // nothing is the only honest answer; the API refuses to issue in that state.
  if (base <= 0 || rate <= 0 || !gstType || gstType === "unknown") return ZERO;

  if (gstType === "interstate") {
    const igst = Math.round((base * rate) / 100);
    return { cgst: 0, sgst: 0, igst, total: igst };
  }

  const half = Math.round((base * rate) / 200);
  return { cgst: half, sgst: half, igst: 0, total: half * 2 };
}

/**
 * The 2-digit place-of-supply code.
 *
 * A registered buyer's GSTIN carries it in its first two characters, which is
 * authoritative. An unregistered (B2C) buyer is placed by the state picked on
 * the invoice. Null when neither is usable — the caller must then refuse to
 * issue a GST invoice rather than print a silently wrong tax split.
 */
export function placeOfSupply(buyerGstin: string, buyerStateName: string): string | null {
  const fromGstin = gstStateCodeFromGstin(buyerGstin);
  if (fromGstin) return fromGstin;

  const fromState = gstStateCode(buyerStateName);
  if (fromState && GST_STATES.some((s) => s.code === fromState)) return fromState;

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/tax.test.ts`
Expected: PASS, 11 tests.

If `placeOfSupply("", "Gujarat")` fails, read `gstStateCode()` in
`src/lib/gst/states.ts` and match its exact name-normalisation behaviour —
do not change that shared function.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoices/tax.ts src/lib/invoices/tax.test.ts
git commit -m "$(cat <<'EOF'
Add the invoice CGST/SGST/IGST split

CGST and SGST are each computed at half the rate rather than by halving one
rounded total: they are separate levies and must print as equal figures,
which halving breaks by a rupee on an odd amount. An undetermined place of
supply charges nothing, so a wrong tax split can never be printed silently.

The intra/inter-state rule itself is reused from lib/gst/states.ts, which
already mirrors the SQL the Orders module persists with.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Totals and amount in words

**Files:**
- Create: `src/lib/invoices/totals.ts`
- Test: `src/lib/invoices/totals.test.ts`

**Interfaces:**
- Consumes: `InvoiceLine`, `InvoiceData` from `./types`; `splitTax`, `TaxSplit` from `./tax`; `GstType` from `@/lib/gst/states`.
- Produces: `lineAmount(line: InvoiceLine): number`; `InvoiceTotals`; `invoiceTotals(lines: InvoiceLine[], opts: TotalsOptions): InvoiceTotals`; `amountInWords(amount: number): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/totals.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { amountInWords, invoiceTotals, lineAmount } from "./totals";
import type { InvoiceLine } from "./types";

function line(partial: Partial<InvoiceLine>): InvoiceLine {
  return {
    label: "OZZO CRM + SFA",
    description: "",
    sac: "998314",
    users: 1,
    months: 1,
    rate: 0,
    ...partial,
  };
}

describe("lineAmount", () => {
  test("a subscription line multiplies users, months and rate", () => {
    expect(lineAmount(line({ users: 5, months: 12, rate: 400 }))).toBe(24000);
  });

  test("a one-off charge is users 1, months 1 and the whole amount in rate", () => {
    expect(lineAmount(line({ users: 1, months: 1, rate: 7500 }))).toBe(7500);
  });

  test("a blank line is zero, never NaN", () => {
    expect(lineAmount(line({ users: Number.NaN, rate: 400 }))).toBe(0);
  });
});

describe("invoiceTotals", () => {
  const lines = [
    line({ users: 5, months: 12, rate: 400 }), // 24,000
    line({ label: "One-time setup", users: 1, months: 1, rate: 6000 }), // 6,000
  ];

  test("subtotal is every line, extra charges included", () => {
    const t = invoiceTotals(lines, { gstEnabled: false, gstRate: 0, gstType: null });
    expect(t.subtotal).toBe(30000);
    expect(t.taxableValue).toBe(30000);
    expect(t.total).toBe(30000);
    expect(t.taxTotal).toBe(0);
  });

  test("a percent discount comes off the whole subtotal, including extra lines", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountPct: 10,
    });
    expect(t.discountAmount).toBe(3000);
    expect(t.taxableValue).toBe(27000);
  });

  test("a flat discount is used when no percent was given", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountAmount: 2500,
    });
    expect(t.discountAmount).toBe(2500);
    expect(t.taxableValue).toBe(27500);
  });

  test("a percent wins over a flat amount, so a discount can never apply twice", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountPct: 10,
      discountAmount: 2500,
    });
    expect(t.discountAmount).toBe(3000);
  });

  test("a discount cannot exceed the subtotal", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: false,
      gstRate: 0,
      gstType: null,
      discountAmount: 99999,
    });
    expect(t.discountAmount).toBe(30000);
    expect(t.taxableValue).toBe(0);
    expect(t.total).toBe(0);
  });

  test("GST is charged on the discounted value, not the subtotal", () => {
    const t = invoiceTotals(lines, {
      gstEnabled: true,
      gstRate: 18,
      gstType: "intrastate",
      discountPct: 10,
    });
    expect(t.taxableValue).toBe(27000);
    expect(t.cgst).toBe(2430);
    expect(t.sgst).toBe(2430);
    expect(t.igst).toBe(0);
    expect(t.taxTotal).toBe(4860);
    expect(t.total).toBe(31860);
  });

  test("the printed rows always add up to the printed total", () => {
    const t = invoiceTotals([line({ users: 3, months: 3, rate: 557 })], {
      gstEnabled: true,
      gstRate: 18,
      gstType: "intrastate",
    });
    expect(t.taxableValue + t.cgst + t.sgst + t.igst).toBe(t.total);
  });

  test("GST off ignores the rate entirely", () => {
    const t = invoiceTotals(lines, { gstEnabled: false, gstRate: 18, gstType: "intrastate" });
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(30000);
  });

  test("no lines is a zero invoice, not a crash", () => {
    const t = invoiceTotals([], { gstEnabled: true, gstRate: 18, gstType: "intrastate" });
    expect(t).toMatchObject({ subtotal: 0, taxableValue: 0, taxTotal: 0, total: 0 });
  });
});

describe("amountInWords", () => {
  test("the Indian scale: thousand, lakh, crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(7)).toBe("Rupees Seven Only");
    expect(amountInWords(19)).toBe("Rupees Nineteen Only");
    expect(amountInWords(40)).toBe("Rupees Forty Only");
    expect(amountInWords(99)).toBe("Rupees Ninety Nine Only");
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords(1000)).toBe("Rupees One Thousand Only");
    expect(amountInWords(31860)).toBe("Rupees Thirty One Thousand Eight Hundred Sixty Only");
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(123400)).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Only",
    );
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(112345678)).toBe(
      "Rupees Eleven Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only",
    );
  });

  test("a figure with paise is rounded to the rupee", () => {
    expect(amountInWords(99.6)).toBe("Rupees One Hundred Only");
  });

  test("a negative or nonsense figure reads zero rather than crashing a print", () => {
    expect(amountInWords(-5)).toBe("Rupees Zero Only");
    expect(amountInWords(Number.NaN)).toBe("Rupees Zero Only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/totals.test.ts`
Expected: FAIL — cannot resolve `./totals`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoices/totals.ts`:

```ts
// ============================================================
// Every figure that prints on an invoice, from its lines and four options.
//
// The ONE place the discount is applied. `quote()` in lib/plans/pricing.ts can
// discount too, so the invoice calls it with discountPct 0 and gstRate 0 and
// uses it only for the rate and the gross plan-line amount. Otherwise a
// discount would come off the plan line inside quote() and off the subtotal
// again here, and the extra charge lines would escape it entirely.
//
// Deliberately whole-rupee throughout: an invoice printing ₹26,082.40 invites a
// conversation about forty paise. Tax is computed ONCE, over the discounted
// taxable value, never per line, so the printed rows always add up to the
// printed total.
// ============================================================

import type { GstType } from "@/lib/gst/states";
import { splitTax } from "./tax";
import type { InvoiceLine } from "./types";

export interface TotalsOptions {
  gstEnabled: boolean;
  /** Percent. Ignored entirely when `gstEnabled` is false. */
  gstRate: number;
  gstType: GstType | null;
  /** Percent, 0–100. Takes precedence over `discountAmount`. */
  discountPct?: number;
  /** Rupees. Used only when `discountPct` is absent or zero. */
  discountAmount?: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  total: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Users × months × rate. A one-off charge is 1 × 1 × the whole amount. */
export function lineAmount(line: InvoiceLine): number {
  return Math.round(num(line?.users) * num(line?.months) * num(line?.rate));
}

export function invoiceTotals(lines: InvoiceLine[], opts: TotalsOptions): InvoiceTotals {
  const subtotal = (lines ?? []).reduce((sum, l) => sum + lineAmount(l), 0);

  const pct = Math.min(100, Math.max(0, num(opts?.discountPct)));
  const flat = Math.max(0, num(opts?.discountAmount));
  const rawDiscount = pct > 0 ? Math.round((subtotal * pct) / 100) : flat;

  // A discount larger than the invoice is a typo, not a credit note.
  const discountAmount = Math.min(subtotal, Math.round(rawDiscount));
  const taxableValue = subtotal - discountAmount;

  const tax = opts?.gstEnabled
    ? splitTax(taxableValue, num(opts.gstRate), opts.gstType)
    : { cgst: 0, sgst: 0, igst: 0, total: 0 };

  return {
    subtotal,
    discountAmount,
    taxableValue,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    taxTotal: tax.total,
    total: taxableValue + tax.total,
  };
}

// ------------------------------------------------------------
// Amount in words — required on a tax invoice, and in the Indian scale
// (thousand, lakh, crore), not the Western one.
// ------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** Recursive on the Indian scale, so a crore figure needs no special case. */
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)] + (rest ? ` ${ONES[rest]}` : "");
  }
  if (n < 1_000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} Hundred` + (rest ? ` ${words(rest)}` : "");
  }
  if (n < 100_000) {
    const rest = n % 1_000;
    return `${words(Math.floor(n / 1_000))} Thousand` + (rest ? ` ${words(rest)}` : "");
  }
  if (n < 10_000_000) {
    const rest = n % 100_000;
    return `${words(Math.floor(n / 100_000))} Lakh` + (rest ? ` ${words(rest)}` : "");
  }
  const rest = n % 10_000_000;
  return `${words(Math.floor(n / 10_000_000))} Crore` + (rest ? ` ${words(rest)}` : "");
}

/** "Rupees One Lakh Twenty Three Thousand Four Hundred Only". */
export function amountInWords(amount: number): string {
  const n = Math.round(Math.max(0, num(amount)));
  return `Rupees ${n === 0 ? "Zero" : words(n)} Only`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/totals.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoices/totals.ts src/lib/invoices/totals.test.ts
git commit -m "$(cat <<'EOF'
Add invoice totals and the amount in words

This is the one place the discount is applied: quote() is called with
discountPct 0 so a discount cannot come off the plan line there and off the
subtotal again here, which would also have let the extra charge lines
escape it. Tax is computed once over the discounted value, so the printed
rows always add up to the printed total.

Amount in words is on the Indian scale — thousand, lakh, crore — because
that is what a tax invoice is read against here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Status transitions

**Files:**
- Create: `src/lib/invoices/status.ts`
- Test: `src/lib/invoices/status.test.ts`

**Interfaces:**
- Consumes: `InvoiceStatus`, `INVOICE_STATUSES` from `./types`.
- Produces: `isInvoiceStatus(v: unknown): v is InvoiceStatus`; `canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean`; `nextStatuses(from: InvoiceStatus): InvoiceStatus[]`; `isEditable(status: InvoiceStatus): boolean`; `statusPatch(to, receivedSoFar, total, today)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/status.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { canTransition, isEditable, isInvoiceStatus, nextStatuses, statusPatch } from "./status";

describe("isInvoiceStatus", () => {
  test("accepts the five real statuses and nothing else", () => {
    expect(isInvoiceStatus("draft")).toBe(true);
    expect(isInvoiceStatus("part_paid")).toBe(true);
    expect(isInvoiceStatus("sent")).toBe(false);
    expect(isInvoiceStatus(null)).toBe(false);
  });
});

describe("canTransition", () => {
  test("a draft may be issued or cancelled", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
  });

  test("a draft may not jump straight to paid", () => {
    expect(canTransition("draft", "paid")).toBe(false);
  });

  test("an issued invoice may be part paid, paid or cancelled", () => {
    expect(canTransition("issued", "part_paid")).toBe(true);
    expect(canTransition("issued", "paid")).toBe(true);
    expect(canTransition("issued", "cancelled")).toBe(true);
  });

  test("nothing goes back to draft once issued", () => {
    expect(canTransition("issued", "draft")).toBe(false);
    expect(canTransition("part_paid", "draft")).toBe(false);
  });

  test("part paid may finish or be cancelled, but not reopen", () => {
    expect(canTransition("part_paid", "paid")).toBe(true);
    expect(canTransition("part_paid", "cancelled")).toBe(true);
    expect(canTransition("part_paid", "issued")).toBe(false);
  });

  test("paid and cancelled are terminal", () => {
    expect(nextStatuses("paid")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(canTransition("paid", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "issued")).toBe(false);
  });

  test("a status never transitions to itself", () => {
    expect(canTransition("issued", "issued")).toBe(false);
  });
});

describe("isEditable", () => {
  test("only a draft may be edited — an issued invoice is frozen", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("issued")).toBe(false);
    expect(isEditable("part_paid")).toBe(false);
    expect(isEditable("paid")).toBe(false);
    expect(isEditable("cancelled")).toBe(false);
  });
});

describe("statusPatch", () => {
  test("marking paid records the whole total and the date", () => {
    expect(statusPatch("paid", 0, 31860, "2026-10-20")).toEqual({
      status: "paid",
      amount_received: 31860,
      paid_at: "2026-10-20",
    });
  });

  test("marking part paid keeps what was received and no paid date", () => {
    expect(statusPatch("part_paid", 10000, 31860, "2026-10-20")).toEqual({
      status: "part_paid",
      amount_received: 10000,
      paid_at: null,
    });
  });

  test("a part payment of the full amount is still recorded as part paid, not guessed", () => {
    // The founder's click is the fact. Promoting it to paid behind his back
    // would stamp a payment date he did not enter.
    expect(statusPatch("part_paid", 31860, 31860, "2026-10-20").status).toBe("part_paid");
  });

  test("a part payment is never more than the total", () => {
    expect(statusPatch("part_paid", 99999, 31860, "2026-10-20").amount_received).toBe(31860);
  });

  test("issuing and cancelling touch no money", () => {
    expect(statusPatch("issued", 0, 31860, "2026-10-20")).toEqual({ status: "issued" });
    expect(statusPatch("cancelled", 0, 31860, "2026-10-20")).toEqual({ status: "cancelled" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/status.test.ts`
Expected: FAIL — cannot resolve `./status`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoices/status.ts`:

```ts
// ============================================================
// The invoice lifecycle, in one place.
//
// draft → issued → part_paid → paid, with cancelled reachable from anything
// not yet terminal. Nothing returns to draft: an issued invoice is a document
// that has left the building, and re-editing it would change figures a
// customer and a CA have already seen.
//
// Validated here AND re-checked in the API route. The client disables the
// buttons; the route is what actually refuses.
// ============================================================

import { INVOICE_STATUSES, type InvoiceStatus } from "./types";

const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["part_paid", "paid", "cancelled"],
  part_paid: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function nextStatuses(from: InvoiceStatus): InvoiceStatus[] {
  return [...(ALLOWED[from] ?? [])];
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/** Only a draft may be edited. Everything else is frozen. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === "draft";
}

/**
 * The columns a status change writes.
 *
 * `paid` records the whole total as received and stamps the date. `part_paid`
 * records what the founder entered, clamped to the total, and leaves `paid_at`
 * null — a part payment that happens to equal the total is still recorded as
 * part paid, because promoting it would stamp a payment date he did not enter.
 */
export function statusPatch(
  to: InvoiceStatus,
  amountReceived: number,
  total: number,
  today: string,
): Record<string, unknown> {
  const cap = Math.max(0, Number(total) || 0);

  if (to === "paid") {
    return { status: to, amount_received: cap, paid_at: today };
  }

  if (to === "part_paid") {
    const received = Math.min(cap, Math.max(0, Number(amountReceived) || 0));
    return { status: to, amount_received: received, paid_at: null };
  }

  return { status: to };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/status.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoices/status.ts src/lib/invoices/status.test.ts
git commit -m "$(cat <<'EOF'
Add the invoice status lifecycle

draft to issued to part paid to paid, cancellable until terminal, and never
back to draft: an issued invoice is a document a customer and a CA have
already seen, so re-editing it is not a state this allows.

A part payment equal to the total stays part paid rather than being
promoted, because promoting it would stamp a payment date nobody entered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Payload → row columns

**Files:**
- Create: `src/lib/invoices/denormalise.ts`
- Test: `src/lib/invoices/denormalise.test.ts`

**Interfaces:**
- Consumes: `InvoiceData`, `InvoiceSeries` from `./types`; `invoiceTotals` from `./totals`; `placeOfSupply` from `./tax`; `determineGstType`, `gstStateCodeFromGstin` from `@/lib/gst/states`; `asTerm` from `@/lib/plans/pricing`.
- Produces: `InvoiceMeta`; `invoiceColumns(data: InvoiceData, meta: InvoiceMeta): Record<string, unknown>`; `planLine(plan, users, term, label)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/denormalise.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { invoiceColumns, planLine } from "./denormalise";
import type { InvoiceData } from "./types";

function data(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    seller: {
      firmName: "OZZO", address: "", pincode: "", state: "Gujarat",
      gstStateCode: "24", gstin: "24AAAAA0000A1Z5", pan: "", phone: "", email: "",
      bankName: "", bankAccountNo: "", ifsc: "", upiId: "", declaration: "",
      signatureUrl: null, logoUrl: null,
    },
    buyer: {
      name: "Shree Narmada Masala", address: "", pincode: "", state: "Gujarat",
      gstStateCode: "24", gstin: "24BBBBB1111B1Z5", contactPerson: "", phone: "", email: "",
    },
    lines: [
      { label: "OZZO CRM + SFA", description: "", sac: "998314", users: 5, months: 12, rate: 400 },
    ],
    discountPct: 0,
    discountAmount: 0,
    notes: "",
    terms: "",
    ...overrides,
  };
}

const meta = {
  series: "gst" as const,
  fy: "26-27",
  seq: 1,
  invoiceNo: "OZZO/26-27/001",
  invoiceDate: "2026-10-20",
  accountId: "acc-1",
  customerId: "001001",
  plan: "CRM_SFA",
  billingTerm: "yearly" as const,
  periodStart: "2026-11-01",
  periodEnd: "2027-10-31",
  gstEnabled: true,
  gstRate: 18,
};

describe("invoiceColumns", () => {
  test("derives every money column from the payload", () => {
    const row = invoiceColumns(data(), meta);
    expect(row).toMatchObject({
      invoice_no: "OZZO/26-27/001",
      series: "gst",
      fy: "26-27",
      seq: 1,
      client_name: "Shree Narmada Masala",
      customer_id: "001001",
      plan: "CRM_SFA",
      billing_term: "yearly",
      users_billed: 5,
      subtotal: 24000,
      taxable_value: 24000,
      cgst_amount: 2160,
      sgst_amount: 2160,
      igst_amount: 0,
      total: 28320,
    });
  });

  test("same state is intra-state, from the two GSTINs", () => {
    expect(invoiceColumns(data(), meta).gst_type).toBe("intrastate");
    expect(invoiceColumns(data(), meta).place_of_supply_code).toBe("24");
  });

  test("a different state is inter-state and taxes as IGST", () => {
    const d = data();
    d.buyer.gstin = "27CCCCC2222C1Z5"; // Maharashtra
    const row = invoiceColumns(d, meta);
    expect(row.gst_type).toBe("interstate");
    expect(row.place_of_supply_code).toBe("27");
    expect(row.igst_amount).toBe(4320);
    expect(row.cgst_amount).toBe(0);
  });

  test("an undeterminable place of supply is 'unknown', never a guess", () => {
    const d = data();
    d.buyer.gstin = "";
    d.buyer.state = "";
    d.buyer.gstStateCode = "";
    const row = invoiceColumns(d, meta);
    expect(row.gst_type).toBe("unknown");
    expect(row.place_of_supply_code).toBeNull();
    expect(row.total).toBe(24000); // no tax charged on a guess
  });

  test("a non-GST invoice stores gst_type null, as the CHECK constraint requires", () => {
    const row = invoiceColumns(data(), { ...meta, gstEnabled: false, series: "non_gst" });
    expect(row.gst_enabled).toBe(false);
    expect(row.gst_type).toBeNull();
    expect(row.place_of_supply_code).toBeNull();
    expect(row.total).toBe(24000);
  });

  test("users_billed is the plan line's users, not the sum of every line", () => {
    const d = data();
    d.lines.push({
      label: "One-time setup", description: "", sac: "998314", users: 1, months: 1, rate: 6000,
    });
    expect(invoiceColumns(d, meta).users_billed).toBe(5);
    expect(invoiceColumns(d, meta).subtotal).toBe(30000);
  });

  test("the whole payload is stored as data", () => {
    const d = data();
    expect(invoiceColumns(d, meta).data).toBe(d);
  });

  test("an unrecognised term reads as yearly, the base rate", () => {
    // Never an uplifted one: a bad value can only ever under-charge.
    const row = invoiceColumns(data(), { ...meta, billingTerm: "monthly" as never });
    expect(row.billing_term).toBe("yearly");
  });
});

describe("planLine", () => {
  test("prices the plan line from the shared quote engine", () => {
    // CRM_SFA at ₹400 pupm yearly, 5 users, 12 months.
    expect(planLine("CRM_SFA", 5, "yearly")).toMatchObject({
      users: 5,
      months: 12,
      rate: 400,
      sac: "998314",
    });
  });

  test("a quarterly line carries the uplifted rate and three months", () => {
    const line = planLine("CRM_SFA", 5, "quarterly");
    expect(line.months).toBe(3);
    expect(line.rate).toBe(560); // 400 × 1.40
  });

  test("the label names the plan", () => {
    expect(planLine("CRM_SFA", 5, "yearly").label).toContain("OZZO");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/denormalise.test.ts`
Expected: FAIL — cannot resolve `./denormalise`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoices/denormalise.ts`:

```ts
// ============================================================
// The payload is the document; these are the columns the list, the filters and
// the outstanding total read. Derived on EVERY write, so "what did I bill them"
// never parses JSONB — and can never disagree with what was printed.
//
// Same pattern as `denormalise()` in /api/admin/proposals/route.ts.
// ============================================================

import { determineGstType, gstStateCodeFromGstin } from "@/lib/gst/states";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { asTerm, quote, TERM_MONTHS, type BillingTerm } from "@/lib/plans/pricing";
import { placeOfSupply } from "./tax";
import { invoiceTotals } from "./totals";
import { DEFAULT_SAC, type InvoiceData, type InvoiceLine, type InvoiceSeries } from "./types";

export interface InvoiceMeta {
  series: InvoiceSeries;
  fy: string;
  seq: number;
  invoiceNo: string;
  invoiceDate: string;
  accountId: string | null;
  customerId: string;
  plan: string;
  billingTerm: BillingTerm;
  periodStart: string | null;
  periodEnd: string | null;
  gstEnabled: boolean;
  gstRate: number;
}

/**
 * The subscription line, priced by the shared engine.
 *
 * `quote()` is called with discountPct 0 and gstRate 0 on purpose: it supplies
 * the per-user-per-month rate for the term and nothing else. The discount and
 * all tax belong to `invoiceTotals()`, which sees the extra charge lines too.
 */
export function planLine(
  plan: PlanId,
  users: number,
  term: BillingTerm,
  label?: string,
): InvoiceLine {
  const q = quote({ plan, users, term, discountPct: 0, gstRate: 0 });

  return {
    label: label ?? `OZZO ${PLAN_LABEL[plan]}`,
    description: `Subscription · ${users} user${users === 1 ? "" : "s"} · ${TERM_MONTHS[term]} months`,
    sac: DEFAULT_SAC,
    users: q.usersBilled,
    months: q.months,
    rate: q.ratePerMonth,
  };
}

export function invoiceColumns(
  data: InvoiceData,
  meta: InvoiceMeta,
): Record<string, unknown> {
  const gstEnabled = !!meta.gstEnabled;

  // Supplier state comes from OUR GSTIN; the buyer's place of supply from
  // theirs, or from the state picked when they have none.
  const supplierCode =
    gstStateCodeFromGstin(data.seller?.gstin) || (data.seller?.gstStateCode ?? "") || null;
  const posCode = gstEnabled
    ? placeOfSupply(data.buyer?.gstin ?? "", data.buyer?.state ?? "")
    : null;

  // The CHECK constraint pairs these two: a GST invoice must carry a gst_type,
  // a non-GST invoice must carry none.
  const gstType = gstEnabled ? determineGstType(supplierCode, posCode) : null;

  const totals = invoiceTotals(data.lines ?? [], {
    gstEnabled,
    gstRate: Number(meta.gstRate) || 0,
    gstType,
    discountPct: Number(data.discountPct) || 0,
    discountAmount: Number(data.discountAmount) || 0,
  });

  return {
    invoice_no: meta.invoiceNo,
    series: meta.series,
    fy: meta.fy,
    seq: meta.seq,
    invoice_date: meta.invoiceDate,
    account_id: meta.accountId,
    customer_id: meta.customerId ?? "",
    client_name: data.buyer?.name ?? "",
    plan: meta.plan ?? "",
    billing_term: asTerm(meta.billingTerm),
    // The SUBSCRIPTION line's users, not a sum across lines: a one-off setup
    // charge carrying users 1 would otherwise inflate the seat count.
    users_billed: Number(data.lines?.[0]?.users) || 0,
    period_start: meta.periodStart,
    period_end: meta.periodEnd,
    gst_enabled: gstEnabled,
    gst_rate: Number(meta.gstRate) || 0,
    gst_type: gstType,
    place_of_supply_code: posCode,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    taxable_value: totals.taxableValue,
    cgst_amount: totals.cgst,
    sgst_amount: totals.sgst,
    igst_amount: totals.igst,
    total: totals.total,
    data,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/denormalise.test.ts`
Expected: PASS, 12 tests.

Note on the `planLine` tests: the rupee figures are derived from the real
catalogue, verified while writing this plan — `PLAN_PRICE.CRM_SFA` is 400, so
yearly is ₹400 pupm and quarterly is ₹560 (×1.40). The relationships are
asserted as well as the figures, so a later change to a base rate fails here
rather than on a sales call.

- [ ] **Step 5: Run the whole invoice library and commit**

Run: `npx vitest run src/lib/invoices`
Expected: PASS, all six test files.

```bash
git add src/lib/invoices/denormalise.ts src/lib/invoices/denormalise.test.ts
git commit -m "$(cat <<'EOF'
Derive the invoice row columns from its payload

Every money and GST column is recomputed on each write, so the list and the
outstanding total never parse JSONB and can never disagree with what was
printed. gst_type is null exactly when GST is off, which is what the table's
CHECK constraint requires, and an undeterminable place of supply records
'unknown' and charges nothing rather than guessing a tax split.

users_billed takes the subscription line's users, not a sum: a one-off
setup charge would otherwise inflate the seat count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Invoice Settings API

**Files:**
- Create: `src/app/api/admin/invoice-settings/route.ts`

**Interfaces:**
- Consumes: `requireFounder`, `serviceClient` from `@/lib/auth/superadmin`; `toErrorResponse` from `@/lib/auth/account`; `SellerSnapshot` from `@/lib/invoices/types`.
- Produces: `GET /api/admin/invoice-settings` → `{ settings: SettingsPayload }`; `PUT` with the same shape → `{ ok: true }`. Both founder-only.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/invoice-settings/route.ts`:

```ts
// ============================================================
// OZZO's own seller details for invoices. Founder-only.
//
// One row, keyed `id = true`. Authorise on the caller's own session with
// requireFounder(), and only then touch the service-role client —
// platform_invoice_settings has RLS with no policies, so the service role is
// the only way in.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { gstStateCodeFromGstin } from "@/lib/gst/states";

const COLUMNS =
  "firm_name, address, pincode, state, gst_state_code, gstin, pan, phone, email, " +
  "bank_name, bank_account_no, ifsc, upi_id, declaration, default_terms, " +
  "signature_url, logo_url, next_gst_seq_override, next_non_gst_seq_override";

/** Only these may be written. Anything else in the body is ignored, not trusted. */
const WRITABLE = [
  "firm_name", "address", "pincode", "state", "gst_state_code", "gstin", "pan",
  "phone", "email", "bank_name", "bank_account_no", "ifsc", "upi_id",
  "declaration", "default_terms", "signature_url", "logo_url",
] as const;

export async function GET() {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_invoice_settings")
      .select(COLUMNS)
      .eq("id", true)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ settings: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireFounder();
    const body = await req.json().catch(() => ({}));

    const patch: Record<string, unknown> = {};
    for (const key of WRITABLE) {
      if (body?.[key] !== undefined) {
        patch[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
      }
    }

    // The supplier state code is derived, never typed: it IS the GSTIN's first
    // two digits, and a hand-typed one that disagrees would flip every invoice
    // between intra- and inter-state.
    const gstin = typeof patch.gstin === "string" ? patch.gstin : undefined;
    if (gstin !== undefined) {
      patch.gst_state_code = gstStateCodeFromGstin(gstin) ?? "";
    }

    // Nullable integers: an empty string must become null, not 0, or the series
    // would be told to start at zero.
    for (const key of ["next_gst_seq_override", "next_non_gst_seq_override"] as const) {
      if (body?.[key] !== undefined) {
        const n = Number(body[key]);
        patch[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await serviceClient()
      .from("platform_invoice_settings")
      .update(patch)
      .eq("id", true);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `src/app/api/admin/invoice-settings/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/invoice-settings/route.ts
git commit -m "$(cat <<'EOF'
Add the invoice settings API, founder-only

Reads and writes the one seller-details row behind requireFounder() and the
service role. The supplier GST state code is derived from the GSTIN rather
than accepted from the body: a hand-typed one that disagreed would flip
every invoice between intra- and inter-state tax.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Invoice list + create API

**Files:**
- Create: `src/app/api/admin/invoices/route.ts`

**Interfaces:**
- Consumes: everything from `@/lib/invoices/*`; `todayInIndia` from `@/lib/proposals/today`.
- Produces: `GET /api/admin/invoices` → `{ invoices: InvoiceRow[] }`; `POST` with `{ data, meta }` → `{ id, invoice_no }`. Exports `resolveNumber()` for reuse by the `[id]` route.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/invoices/route.ts`:

```ts
// ============================================================
// Invoice list + create. Founder-only.
//
// requireFounder() on the caller's own session, then the service-role client —
// platform_invoices has RLS with no policies, which is the point.
//
// Creating is where the number is assigned. The unique index on
// (series, fy, seq) is the real guard: a collision is a 23505, retried once.
// Reading max(seq) and adding one is racy in theory and this is a single-user
// module in practice, so the index does the work rather than a lock.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { invoiceColumns, type InvoiceMeta } from "@/lib/invoices/denormalise";
import { financialYear } from "@/lib/invoices/fy";
import { buildInvoiceNo, nextSeq } from "@/lib/invoices/number";
import type { InvoiceData, InvoiceSeries } from "@/lib/invoices/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_COLUMNS =
  "id, invoice_no, series, fy, seq, invoice_date, account_id, customer_id, client_name, " +
  "plan, billing_term, users_billed, period_start, period_end, gst_enabled, gst_rate, " +
  "gst_type, place_of_supply_code, subtotal, discount_amount, taxable_value, cgst_amount, " +
  "sgst_amount, igst_amount, total, amount_received, status, paid_at, created_at, updated_at";

export async function GET() {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_invoices")
      .select(LIST_COLUMNS)
      .order("invoice_date", { ascending: false })
      .order("seq", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ invoices: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function isSeries(value: unknown): value is InvoiceSeries {
  return value === "gst" || value === "non_gst";
}

/**
 * The next number in a series, honouring the founder's starting override.
 *
 * Exported so the edit route can renumber a draft whose series or date changed
 * financial year — an invoice that moves from the GST book to the non-GST one
 * must not keep a number from the book it left.
 */
export async function resolveNumber(
  admin: SupabaseClient,
  series: InvoiceSeries,
  invoiceDate: string,
): Promise<{ fy: string; seq: number; invoiceNo: string }> {
  const fy = financialYear(invoiceDate);

  const { data: last } = await admin
    .from("platform_invoices")
    .select("seq")
    .eq("series", series)
    .eq("fy", fy)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: settings } = await admin
    .from("platform_invoice_settings")
    .select("next_gst_seq_override, next_non_gst_seq_override")
    .eq("id", true)
    .maybeSingle();

  const override =
    series === "gst"
      ? (settings?.next_gst_seq_override ?? null)
      : (settings?.next_non_gst_seq_override ?? null);

  const seq = nextSeq(last?.seq ?? null, override);
  return { fy, seq, invoiceNo: buildInvoiceNo(series, fy, seq) };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = await req.json().catch(() => ({}));

    const data = body?.data as InvoiceData | undefined;
    const meta = body?.meta as Partial<InvoiceMeta> | undefined;

    if (!data?.buyer || !Array.isArray(data?.lines)) {
      return NextResponse.json({ error: "Missing invoice data" }, { status: 400 });
    }

    const series: InvoiceSeries = isSeries(meta?.series) ? meta.series : "gst";
    const invoiceDate = typeof meta?.invoiceDate === "string" ? meta.invoiceDate : todayInIndia();
    const admin = serviceClient();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { fy, seq, invoiceNo } = await resolveNumber(admin, series, invoiceDate);

      const columns = invoiceColumns(data, {
        series,
        fy,
        seq,
        invoiceNo,
        invoiceDate,
        accountId: typeof meta?.accountId === "string" ? meta.accountId : null,
        customerId: typeof meta?.customerId === "string" ? meta.customerId : "",
        plan: typeof meta?.plan === "string" ? meta.plan : "",
        billingTerm: asTerm(meta?.billingTerm),
        periodStart: typeof meta?.periodStart === "string" ? meta.periodStart : null,
        periodEnd: typeof meta?.periodEnd === "string" ? meta.periodEnd : null,
        // A non-GST invoice is exactly "GST off", so the series decides it and
        // the two can never disagree.
        gstEnabled: series === "gst",
        gstRate: Number(meta?.gstRate) || 0,
      });

      const { data: row, error } = await admin
        .from("platform_invoices")
        .insert({ ...columns, status: "draft", created_by: ctx.userId })
        .select("id, invoice_no")
        .single();

      if (!error) return NextResponse.json({ id: row.id, invoice_no: row.invoice_no });

      // 23505 = unique violation. Someone (or another tab) took that number
      // between the read and the insert; read again and try once more.
      if (error.code !== "23505" || attempt === 1) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Could not assign an invoice number" }, { status: 409 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/invoices/route.ts
git commit -m "$(cat <<'EOF'
Add the invoice list and create API, founder-only

Creating is where the number is assigned, from the last sequence in that
series and financial year plus the founder's starting override. The unique
index does the real work: a 23505 collision is read again and retried once,
rather than taken on trust from a max(seq) read.

The series decides whether GST applies, so "non-GST invoice" and "GST off"
can never disagree on the same document.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: One-invoice API — read, edit, status, delete

**Files:**
- Create: `src/app/api/admin/invoices/[id]/route.ts`

**Interfaces:**
- Consumes: `resolveNumber` from `../route`; `canTransition`, `isEditable`, `isInvoiceStatus`, `statusPatch` from `@/lib/invoices/status`; `invoiceColumns` from `@/lib/invoices/denormalise`.
- Produces: `GET`, `PATCH` (content edit on a draft, or a status change), `DELETE` (draft only) at `/api/admin/invoices/[id]`.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/invoices/[id]/route.ts`:

```ts
// ============================================================
// Read / edit / status / delete one invoice. Founder-only, service-role.
//
// Two kinds of write, kept strictly apart:
//   - a CONTENT edit, allowed only while the invoice is a draft, and
//   - a STATUS change, which never touches the document.
// Mixing them would let "mark paid" quietly re-price a document a customer has
// already seen.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { invoiceColumns } from "@/lib/invoices/denormalise";
import { canTransition, isEditable, isInvoiceStatus, statusPatch } from "@/lib/invoices/status";
import type { InvoiceData, InvoiceSeries, InvoiceStatus } from "@/lib/invoices/types";
import { resolveNumber } from "../route";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    const { data, error } = await serviceClient()
      .from("platform_invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    return NextResponse.json({ invoice: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const body = await req.json().catch(() => ({}));
    const admin = serviceClient();

    const { data: current } = await admin
      .from("platform_invoices")
      .select("id, status, total, series, fy, seq, invoice_no, invoice_date, gst_enabled")
      .eq("id", id)
      .maybeSingle();

    if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // ---- a status change -------------------------------------------------
    if (body?.status !== undefined) {
      if (!isInvoiceStatus(body.status)) {
        return NextResponse.json({ error: `Unknown status "${body.status}"` }, { status: 400 });
      }

      const from = current.status as InvoiceStatus;
      if (!canTransition(from, body.status)) {
        return NextResponse.json(
          { error: `An invoice that is ${from} cannot become ${body.status}.` },
          { status: 409 },
        );
      }

      // A GST invoice whose place of supply could not be determined would print
      // no tax at all. Refuse to issue it rather than let it out silently.
      if (body.status === "issued" && current.gst_enabled) {
        const { data: full } = await admin
          .from("platform_invoices")
          .select("gst_type, place_of_supply_code")
          .eq("id", id)
          .maybeSingle();

        if (!full?.gst_type || full.gst_type === "unknown") {
          return NextResponse.json(
            {
              error:
                "Cannot issue a GST invoice without a place of supply. Add the customer's GSTIN, or pick their state, then try again.",
            },
            { status: 409 },
          );
        }
      }

      const { error } = await admin
        .from("platform_invoices")
        .update(
          statusPatch(
            body.status,
            Number(body.amount_received) || 0,
            Number(current.total) || 0,
            todayInIndia(),
          ),
        )
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // ---- a content edit --------------------------------------------------
    if (!isEditable(current.status as InvoiceStatus)) {
      return NextResponse.json(
        {
          error: `Invoice ${current.invoice_no} is ${current.status} and can no longer be edited. Cancel it and raise a new one.`,
        },
        { status: 409 },
      );
    }

    const data = body?.data as InvoiceData | undefined;
    const meta = body?.meta ?? {};
    if (!data?.buyer || !Array.isArray(data?.lines)) {
      return NextResponse.json({ error: "Missing invoice data" }, { status: 400 });
    }

    const series = (meta.series === "non_gst" ? "non_gst" : "gst") as InvoiceSeries;
    const invoiceDate =
      typeof meta.invoiceDate === "string" ? meta.invoiceDate : current.invoice_date;

    // A draft that changed series or financial year must be renumbered: keeping
    // a number from the book it left would break both books' consecutiveness.
    const needsNewNumber =
      series !== current.series || meta.invoiceDate !== current.invoice_date;

    const numbering = needsNewNumber
      ? await resolveNumber(admin, series, invoiceDate)
      : { fy: current.fy, seq: current.seq, invoiceNo: current.invoice_no };

    const columns = invoiceColumns(data, {
      series,
      fy: numbering.fy,
      seq: numbering.seq,
      invoiceNo: numbering.invoiceNo,
      invoiceDate,
      accountId: typeof meta.accountId === "string" ? meta.accountId : null,
      customerId: typeof meta.customerId === "string" ? meta.customerId : "",
      plan: typeof meta.plan === "string" ? meta.plan : "",
      billingTerm: asTerm(meta.billingTerm),
      periodStart: typeof meta.periodStart === "string" ? meta.periodStart : null,
      periodEnd: typeof meta.periodEnd === "string" ? meta.periodEnd : null,
      gstEnabled: series === "gst",
      gstRate: Number(meta.gstRate) || 0,
    });

    const { error } = await admin.from("platform_invoices").update(columns).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, invoice_no: numbering.invoiceNo });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    // The database trigger refuses this too; checking here is what turns a raw
    // Postgres exception into a sentence the founder can act on.
    const admin = serviceClient();
    const { data: current } = await admin
      .from("platform_invoices")
      .select("status, invoice_no, series")
      .eq("id", id)
      .maybeSingle();

    if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (current.status !== "draft") {
      return NextResponse.json(
        {
          error: `Invoice ${current.invoice_no} is ${current.status}. Cancel it instead — deleting it would leave a gap in the ${current.series === "gst" ? "GST" : "non-GST"} series.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin.from("platform_invoices").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/invoices/[id]/route.ts"
git commit -m "$(cat <<'EOF'
Add the one-invoice API: read, edit, status, delete

A content edit and a status change are separate paths, and a content edit is
refused on anything but a draft: mixing them would let "mark paid" quietly
re-price a document the customer has already seen.

Two refusals worth naming. A GST invoice with no determinable place of
supply cannot be issued, because it would print no tax at all. An issued
invoice cannot be deleted, only cancelled, because a hole in the series is
what GST does not allow — the trigger says so too; this says it in a
sentence the founder can act on.

A draft that changes series or financial year is renumbered, so neither book
inherits a number from the other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Invoice Settings screen

**Files:**
- Create: `src/app/(superadmin)/admin/invoice-settings/page.tsx`
- Create: `src/app/(superadmin)/admin/invoice-settings/settings-form.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/invoice-settings`.
- Produces: the screen at `/admin/invoice-settings`.

- [ ] **Step 1: Write the server guard**

Create `src/app/(superadmin)/admin/invoice-settings/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import SettingsForm from "./settings-form";

// OZZO's own seller details — founder-only.
//
// Triple-gated, like the proposals screens: the (superadmin) layout blocks
// non-superadmins, requireFounder() 404s any other superadmin, and
// platform_invoice_settings has RLS with no policies.
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <SettingsForm />;
}
```

- [ ] **Step 2: Write the form**

Create `src/app/(superadmin)/admin/invoice-settings/settings-form.tsx`. Build it
with `Input`, `Label`, `Textarea`, `Button` from `@/components/ui/*`, `toast`
from `sonner`, and the state picker pattern from
`src/components/settings/company-profile-panel.tsx` (which uses `GST_STATES`).

Required structure:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GST_STATES } from "@/lib/gst/states";

interface SettingsShape {
  firm_name: string;
  address: string;
  pincode: string;
  state: string;
  gst_state_code: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_account_no: string;
  ifsc: string;
  upi_id: string;
  declaration: string;
  default_terms: string;
  signature_url: string | null;
  logo_url: string | null;
  next_gst_seq_override: number | null;
  next_non_gst_seq_override: number | null;
}

const BLANK: SettingsShape = {
  firm_name: "", address: "", pincode: "", state: "", gst_state_code: "",
  gstin: "", pan: "", phone: "", email: "", bank_name: "", bank_account_no: "",
  ifsc: "", upi_id: "",
  declaration:
    "We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.",
  default_terms: "", signature_url: null, logo_url: null,
  next_gst_seq_override: null, next_non_gst_seq_override: null,
};

export default function SettingsForm() { /* ... */ }
```

Behaviour the form must have:

1. On mount, `fetch("/api/admin/invoice-settings")` and merge the response over
   `BLANK` (the API may return `null` before the migration has run — show a
   plain message saying the migration has not been applied yet, not a crash).
2. Four sections, each a `bg-card border border-border rounded-xl p-6` block
   with a heading, matching the admin look: **Firm** (name, address, pincode,
   state select, phone, email), **Tax** (GSTIN, PAN), **Bank** (bank name,
   account number, IFSC, UPI), **Document** (declaration, default terms,
   signature upload, starting numbers).
3. The state select writes BOTH `state` (the name) and `gst_state_code` (the
   code) from the chosen `GST_STATES` entry — the same pairing
   `company-profile-panel.tsx` does. Show a warning under the GSTIN field when
   `gstin.slice(0,2)` disagrees with `gst_state_code`: "This GSTIN belongs to
   <state>, which is not the state selected above." The API derives the code
   from the GSTIN on save, so the GSTIN wins; the warning says so.
4. Signature upload: an `<input type="file" accept="image/png,image/jpeg">`,
   capped at 1 MB, uploaded to the `document_assets` bucket at
   `platform/invoice-signature-<Date.now()>.<ext>` using
   `createClient()` from `@/lib/supabase/client` and
   `storage.from("document_assets").upload(path, file, { upsert: true })`, then
   `getPublicUrl(path)` stored in `signature_url`. Mirror the upload-and-
   preview flow in `company-profile-panel.tsx`, including the size check and
   the MIME allow-list.
5. Save posts the whole shape with `PUT`, then `toast.success("Invoice settings saved")`,
   or `toast.error(payload.error)` on failure.
6. Both "starting number" inputs are `type="number"` with the helper text:
   "Leave blank unless you have already issued invoices this financial year
   outside OZZO. The series never goes backwards, so a number already passed is
   ignored."

- [ ] **Step 3: Verify it renders**

Run: `npm run build`
Expected: a clean build, with `/admin/invoice-settings` in the route list.

Then start the dev preview and open `/admin/invoice-settings` as the founder.
Check: the four sections render, the state select fills both fields, saving
shows the success toast, and reloading shows the saved values.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(superadmin)/admin/invoice-settings"
git commit -m "$(cat <<'EOF'
Add the Invoice Settings screen

Firm, tax, bank and document details in one founder-only form, so changing
the bank account on an invoice is a form edit and not a deploy. The state
select writes both the name and the 2-digit code together, and a GSTIN that
disagrees with the state selected is called out — the GSTIN wins, because it
is what decides intra- versus inter-state tax.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: The invoice list screen

**Files:**
- Create: `src/app/(superadmin)/admin/invoices/page.tsx`
- Create: `src/app/(superadmin)/admin/invoices/invoices-client.tsx`
- Modify: `src/app/(superadmin)/admin/admin-shell.tsx` — add the nav entry

**Interfaces:**
- Consumes: `GET /api/admin/invoices`; `DataTable` + `ColumnDef` from `@/components/ui/data-table/*`; `useTableView` from `@/hooks/use-table-view`; `matchesColumnFilters` from `@/lib/table/match-filters`; `formatCurrency` from `@/lib/currency`.
- Produces: the screen at `/admin/invoices`.

- [ ] **Step 1: Write the server guard**

Create `src/app/(superadmin)/admin/invoices/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import InvoicesClient from "./invoices-client";

// OZZO's own invoices — founder-only, same triple gate as the proposals list.
export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <InvoicesClient />;
}
```

- [ ] **Step 2: Write the list client**

Create `src/app/(superadmin)/admin/invoices/invoices-client.tsx`. Follow the
house table pattern: `useTableView("platform_invoices", {})` owns filters and
columns, the page filters its own rows with `matchesColumnFilters`, and
`<DataTable>` renders.

The columns array, in full:

```tsx
const columns: ColumnDef<InvoiceRow>[] = [
  { id: "invoice_no", label: "Invoice No", type: "text", sortable: true,
    render: (r) => <span className="font-medium">{r.invoice_no}</span> },
  { id: "invoice_date", label: "Date", type: "date", sortable: true,
    render: (r) => formatDate(r.invoice_date) },
  { id: "series", label: "Type", type: "select",
    options: [{ label: "GST", value: "gst" }, { label: "Non-GST", value: "non_gst" }],
    render: (r) => SERIES_LABEL[r.series] },
  { id: "client_name", label: "Customer", type: "text", sortable: true },
  { id: "customer_id", label: "Customer ID", type: "text" },
  { id: "plan", label: "Plan", type: "text",
    render: (r) => PLAN_LABEL[r.plan as PlanId] ?? r.plan },
  { id: "period", label: "Period", type: "text", sortable: false,
    filterValue: (r) => `${r.period_start ?? ""} ${r.period_end ?? ""}`,
    render: (r) => r.period_start && r.period_end
      ? `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` : "—" },
  { id: "users_billed", label: "Users", type: "range", sortable: true },
  { id: "taxable_value", label: "Taxable", type: "range", sortable: true,
    render: (r) => formatCurrency(r.taxable_value) },
  { id: "tax", label: "Tax", type: "range", sortable: true,
    filterValue: (r) => r.cgst_amount + r.sgst_amount + r.igst_amount,
    render: (r) => formatCurrency(r.cgst_amount + r.sgst_amount + r.igst_amount) },
  { id: "total", label: "Total", type: "range", sortable: true,
    render: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span> },
  { id: "amount_received", label: "Received", type: "range", sortable: true,
    render: (r) => formatCurrency(r.amount_received) },
  { id: "balance", label: "Balance", type: "range", sortable: true,
    filterValue: (r) => r.total - r.amount_received,
    render: (r) => {
      const balance = r.total - r.amount_received;
      return <span className={balance > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
        {formatCurrency(balance)}
      </span>;
    } },
  { id: "status", label: "Status", type: "select",
    options: INVOICE_STATUSES.map((s) => ({ label: INVOICE_STATUS_LABEL[s], value: s })),
    render: (r) => <StatusBadge status={r.status} /> },
  { id: "fy", label: "FY", type: "select",
    options: [], // filled from the loaded rows: see step 3
    visibleByDefault: false },
];
```

Also in this file:

- `StatusBadge`: a small `<span>` with `rounded-full px-2 py-1 text-xs font-medium` and
  a colour per status — draft muted (`bg-muted text-muted-foreground`), issued blue,
  part_paid amber, paid green, cancelled red. Use the `bg-*-500/10 text-*-600
  dark:text-*-400` form the admin pages already use, never `hsl(var(--x))` in a
  raw style.
- A footer summary row above the table: three tiles showing `formatCurrency` of
  total, received and balance **across the filtered rows**, plus the count. Soft
  of the same shape as the billing page's KPI tiles.
- An `actions` prop holding a `+ New Invoice` link to `/admin/invoices/new` and a
  `Settings` link to `/admin/invoice-settings`.
- `onRowClick` pushes `/admin/invoices/${row.id}`.
- `emptyMessage` reading "No invoices yet. Raise the first one with + New Invoice."
  and, when the fetch failed with a 400 mentioning a missing relation, the plain
  sentence "The invoices migration has not been applied to the database yet."

- [ ] **Step 3: Fill the FY filter options from the data**

The FY select cannot be hardcoded — it grows one entry per financial year. Build
it with `useMemo` over the loaded rows:

```tsx
const fyOptions = useMemo(
  () =>
    Array.from(new Set(invoices.map((i) => i.fy)))
      .sort()
      .reverse()
      .map((fy) => ({ label: `FY ${fy}`, value: fy })),
  [invoices],
);
```

and splice it into the `columns` array inside a `useMemo` keyed on `fyOptions`,
so the column definitions are stable between renders.

- [ ] **Step 4: Add the nav entry**

In `src/app/(superadmin)/admin/admin-shell.tsx`, import `Receipt` from
`lucide-react` and add to `FOUNDER_NAV_ITEMS`, after the Price Calculator entry:

```tsx
  { href: "/admin/invoices", label: "Invoices", icon: Receipt },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean, with `/admin/invoices` in the route list.

Open `/admin/invoices` as the founder. Check: the nav link appears, the table
renders (empty is fine), every column has a working filter in the filter row,
Manage Columns lists all of them, and the totals tiles react to a filter.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(superadmin)/admin/invoices/page.tsx" "src/app/(superadmin)/admin/invoices/invoices-client.tsx" "src/app/(superadmin)/admin/admin-shell.tsx"
git commit -m "$(cat <<'EOF'
Add the invoice list screen

The house table: a filter on every column including money ranges on taxable,
tax, total, received and balance, Manage Columns over all of them, and
totals tiles that follow the filters rather than the whole table. The
financial-year filter is built from the loaded rows, because that list grows
by one entry every April.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: The invoice form

**Files:**
- Create: `src/app/(superadmin)/admin/invoices/invoice-form.tsx`
- Create: `src/app/(superadmin)/admin/invoices/new/page.tsx`
- Create: `src/app/(superadmin)/admin/invoices/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/companies`, `GET /api/admin/invoice-settings`, `POST /api/admin/invoices`, `PATCH /api/admin/invoices/[id]`; `planLine` from `@/lib/invoices/denormalise`; `invoiceTotals`, `amountInWords` from `@/lib/invoices/totals`; `placeOfSupply` from `@/lib/invoices/tax`; `determineGstType` from `@/lib/gst/states`; `TERM_MONTHS`, `TERM_LABEL`, `BILLING_TERMS`, `renewalDate` from `@/lib/plans/pricing`.
- Produces: `<InvoiceForm mode="create" />` and `<InvoiceForm mode="edit" invoice={row} />`.

- [ ] **Step 1: Write the two server guards**

`src/app/(superadmin)/admin/invoices/new/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import InvoiceForm from "../invoice-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <InvoiceForm mode="create" />;
}
```

`src/app/(superadmin)/admin/invoices/[id]/edit/page.tsx`: the same guard, then
load the row with `serviceClient()` and `maybeSingle()`, `notFound()` when it is
missing, and — because only a draft may be edited — `redirect(`/admin/invoices/${id}`)`
when `row.status !== "draft"`. Pass `<InvoiceForm mode="edit" invoice={row} />`.

- [ ] **Step 2: Write the form**

Create `src/app/(superadmin)/admin/invoices/invoice-form.tsx`. It is a client
component holding one state object shaped like the POST body:

```tsx
interface FormState {
  series: InvoiceSeries;
  invoiceDate: string;      // yyyy-mm-dd
  accountId: string | null;
  customerId: string;
  plan: PlanId;
  billingTerm: BillingTerm;
  periodStart: string;
  periodEnd: string;
  gstRate: number;
  buyer: BuyerSnapshot;
  lines: InvoiceLine[];
  discountPct: number;
  discountAmount: number;
  notes: string;
  terms: string;
}
```

Behaviour, in the order the founder meets it:

1. **Account picker.** `fetch("/api/admin/companies")` on mount. A `<select>` of
   `name (customer_id)`. Choosing one fills `accountId`, `customerId`, `plan`,
   the plan line's `users` from `seat_count`, and `buyer` from that account's
   company profile. The companies route does **not** return the company profile
   today, so fetch it in the same effect via
   `GET /api/admin/accounts/<id>` — read that route first and, if it does not
   expose `settings.company_profile`, add the three fields to its select
   (`settings`) rather than querying `accounts` from the browser, which tenant
   scoping now blocks (migration `20261017120000`).
2. **Series toggle.** Two buttons, GST / Non-GST. GST sets `gstRate` to
   `DEFAULT_GST_RATE` (18) from `@/lib/plans/pricing`; Non-GST sets it to 0 and
   hides the whole tax block.
3. **Term + period.** A `<select>` over `BILLING_TERMS` with `TERM_LABEL`, and a
   start-date input. On either change, recompute:

```tsx
function periodEndFor(start: string, term: BillingTerm): string {
  // renewalDate() gives the date one whole term later; the period ENDS the day
  // before that, so 01 Nov 2026 + yearly ends 31 Oct 2027, not 01 Nov.
  const [y, m, d] = start.split("-").map(Number);
  const end = renewalDate(new Date(y, m - 1, d), term);
  end.setDate(end.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}
```

   `periodEnd` stays editable after that — recompute only when the start date or
   the term changes, never on every keystroke in the end field.
4. **The plan line** is rebuilt by `planLine(plan, users, term)` whenever plan,
   users or term change, but its `label` and `rate` stay editable: the founder
   may have agreed a different rate. Show the list rate beside an edited one as
   `List ₹400` so an override is visible.
5. **Extra lines.** An "Add charge" button appends
   `{ label: "", description: "", sac: DEFAULT_SAC, users: 1, months: 1, rate: 0 }`.
   Each row has a delete button. The plan line (index 0) cannot be deleted.
6. **Discount.** A percent input and a flat-amount input, with the helper text
   "A percent, if given, is used instead of the flat amount." Wire exactly that:
   `discountPct > 0` disables the flat field.
7. **A live totals panel**, recomputed with the same functions the server uses,
   so the preview can never disagree with the saved row:

```tsx
const posCode = placeOfSupply(form.buyer.gstin, form.buyer.state);
const gstType = form.series === "gst"
  ? determineGstType(settings?.gst_state_code ?? null, posCode)
  : null;
const totals = invoiceTotals(form.lines, {
  gstEnabled: form.series === "gst",
  gstRate: form.gstRate,
  gstType,
  discountPct: form.discountPct,
  discountAmount: form.discountAmount,
});
```

   The panel shows subtotal, discount, taxable value, then **either** CGST and
   SGST **or** IGST, then the total and `amountInWords(totals.total)`.
8. **The place-of-supply warning.** When the series is GST and `gstType` is
   `"unknown"`, show a prominent amber block: "No place of supply. Add the
   customer's GSTIN, or pick their state. This invoice can be saved as a draft
   but cannot be issued." This mirrors exactly what the API refuses, so the
   founder is never surprised at the issue step.
9. **Save.** `POST /api/admin/invoices` with `{ data, meta }` in create mode,
   `PATCH /api/admin/invoices/<id>` in edit mode, then
   `router.push(`/admin/invoices/${id}`)`. On error, `toast.error(payload.error)`.
   The `data` half is `{ seller, buyer, lines, discountPct, discountAmount, notes, terms }`
   — `seller` is the settings row mapped to `SellerSnapshot`, snapshotted at save
   time.

Use the repo's 4-column form density and `FormPageShell` if the other admin
forms use it — check `src/app/(superadmin)/admin/proposals/[id]/edit/proposal-form.tsx`
first and follow whatever shell it uses.

- [ ] **Step 3: Verify against the real screens**

Run: `npm run typecheck && npm run build`

Then, in the dev preview as the founder:
- create a GST invoice for a tenant in your own state → the panel shows CGST and
  SGST, equal, and the total matches taxable + both;
- change the buyer's GSTIN to one starting `27` → the panel switches to IGST;
- clear the GSTIN and the state → the amber place-of-supply warning appears;
- switch to Non-GST → the tax block disappears and the total equals the taxable
  value;
- set the term to quarterly → the rate rises by 40% and months becomes 3;
- set a start date of 01 Nov 2026 with a yearly term → the end date reads
  31 Oct 2027.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(superadmin)/admin/invoices/invoice-form.tsx" "src/app/(superadmin)/admin/invoices/new" "src/app/(superadmin)/admin/invoices/[id]/edit"
git commit -m "$(cat <<'EOF'
Add the invoice form

Picking a tenant pre-fills its address, GSTIN, plan and seats; the term and
a start date fill the service period, ending the day before the next term
begins. The live totals panel is computed by the same invoiceTotals() and
determineGstType() the server uses, so the preview cannot disagree with the
saved row, and the place-of-supply warning says exactly what the API will
refuse at the issue step.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: The invoice detail screen

**Files:**
- Create: `src/app/(superadmin)/admin/invoices/[id]/page.tsx`
- Create: `src/app/(superadmin)/admin/invoices/[id]/invoice-detail.tsx`

**Interfaces:**
- Consumes: `PATCH`/`DELETE /api/admin/invoices/[id]`; `nextStatuses`, `isEditable` from `@/lib/invoices/status`.
- Produces: the screen at `/admin/invoices/[id]`.

- [ ] **Step 1: Write the server guard**

`src/app/(superadmin)/admin/invoices/[id]/page.tsx`: `requireFounder()` in a
try/catch with `notFound()`, then load the full row (`select("*")`) with
`serviceClient()`, `notFound()` when missing, and render
`<InvoiceDetail invoice={row} />`.

- [ ] **Step 2: Write the detail component**

Create `src/app/(superadmin)/admin/invoices/[id]/invoice-detail.tsx` with:

1. **A header card**: invoice number, `<StatusBadge>`, series label, customer
   name and Customer ID, invoice date, service period, and the total.
2. **Action buttons**, driven by `nextStatuses(invoice.status)` so the UI can
   never offer a transition the API refuses:
   - `Issue` → `PATCH { status: "issued" }`
   - `Mark Part Paid` → opens a small dialog with an amount input, then
     `PATCH { status: "part_paid", amount_received }`
   - `Mark Paid` → `PATCH { status: "paid" }`
   - `Cancel` → a confirm dialog ("The number stays in the series. This cannot
     be undone."), then `PATCH { status: "cancelled" }`
   - `Edit` → link to `./edit`, rendered only when `isEditable(invoice.status)`
   - `Delete` → only when `isEditable(invoice.status)`, with a confirm
   Each click sets a busy state, toasts the error on failure, and
   `router.refresh()` on success.
3. **Print and WhatsApp**:
   - `Print / PDF` opens `/print/invoice/<id>` in a new tab.
   - `WhatsApp` opens `https://wa.me/<digits>?text=<encoded>` where digits is
     `invoice.data.buyer.phone.replace(/\D/g, "")` (prefixed `91` when it is ten
     digits) and the text is built by a small local function:

```tsx
function whatsappText(inv: InvoiceRow): string {
  const lines = [
    `Invoice ${inv.invoice_no} from ${inv.data.seller.firmName}`,
    inv.period_start && inv.period_end
      ? `Service period: ${formatDate(inv.period_start)} to ${formatDate(inv.period_end)}`
      : "",
    `Amount: ${formatCurrency(inv.total)}`,
    inv.data.seller.bankAccountNo
      ? `Bank: ${inv.data.seller.bankName} · A/c ${inv.data.seller.bankAccountNo} · IFSC ${inv.data.seller.ifsc}`
      : "",
    inv.data.seller.upiId ? `UPI: ${inv.data.seller.upiId}` : "",
    "The invoice PDF is attached.",
  ];
  return lines.filter(Boolean).join("\n");
}
```

   Beneath the button, in small muted text: "Download the PDF first, then attach
   it in WhatsApp — the print page needs your login, so a link would not open
   for the customer."
4. **A read-only breakdown**: the line items table, then subtotal, discount,
   taxable value, the tax rows that apply, the total, and the amount in words —
   read from the stored columns, not recomputed, because the row IS the record.
5. **A payment strip**: received, balance, and `paid_at` when set.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`

Then in the preview: issue a draft, mark it part paid for less than the total
(balance shows), mark it paid (balance zero, date set), and confirm that a paid
invoice offers no further status buttons and no Edit or Delete.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(superadmin)/admin/invoices/[id]/page.tsx" "src/app/(superadmin)/admin/invoices/[id]/invoice-detail.tsx"
git commit -m "$(cat <<'EOF'
Add the invoice detail screen

The action buttons are generated from nextStatuses(), so the screen can
never offer a transition the API refuses, and Edit and Delete appear only on
a draft. The breakdown is read from the stored columns rather than
recomputed: the row is the record of what was printed.

The WhatsApp button carries the number, period, amount and bank details as
text, and says plainly that the PDF has to be attached — the print page sits
behind the founder's login, so a link would not open for the customer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: The printable invoice

**Files:**
- Create: `src/lib/invoices/template/invoice-document.tsx`
- Test: `src/lib/invoices/template/invoice-document.test.tsx`
- Create: `src/app/print/invoice/[id]/page.tsx`
- Create: `src/app/print/invoice/[id]/download-button.tsx`

**Interfaces:**
- Consumes: `InvoiceRow` from `@/lib/invoices/types`; `amountInWords` from `@/lib/invoices/totals`; `gstStateName` from `@/lib/gst/states`.
- Produces: `<InvoiceDocument invoice={row} />`; the route `/print/invoice/[id]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoices/template/invoice-document.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceDocument } from "./invoice-document";
import type { InvoiceRow } from "../types";

// ---------------------------------------------------------------------------
// The document is the only artefact a customer and a CA ever see. These tests
// pin the three things that make it a valid tax invoice — the title, both
// GSTINs, and the right pair of tax rows — and the one thing that makes the
// non-GST variant safe: no GSTIN and no tax anywhere on it.
// ---------------------------------------------------------------------------

function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1", invoice_no: "OZZO/26-27/001", series: "gst", fy: "26-27", seq: 1,
    invoice_date: "2026-10-20", account_id: "acc-1", customer_id: "001001",
    client_name: "Shree Narmada Masala", plan: "CRM_SFA", billing_term: "yearly",
    users_billed: 5, period_start: "2026-11-01", period_end: "2027-10-31",
    gst_enabled: true, gst_rate: 18, gst_type: "intrastate", place_of_supply_code: "24",
    subtotal: 24000, discount_amount: 0, taxable_value: 24000,
    cgst_amount: 2160, sgst_amount: 2160, igst_amount: 0,
    total: 28320, amount_received: 0, status: "issued", paid_at: null,
    created_at: "", updated_at: "",
    data: {
      seller: {
        firmName: "OZZO Technologies", address: "Surat, Gujarat", pincode: "395006",
        state: "Gujarat", gstStateCode: "24", gstin: "24AAAAA0000A1Z5", pan: "AAAAA0000A",
        phone: "", email: "", bankName: "HDFC Bank", bankAccountNo: "50200012345678",
        ifsc: "HDFC0001234", upiId: "ozzo@hdfcbank", declaration: "We declare that this invoice shows the actual price.",
        signatureUrl: null, logoUrl: null,
      },
      buyer: {
        name: "Shree Narmada Masala", address: "Rajkot, Gujarat", pincode: "360001",
        state: "Gujarat", gstStateCode: "24", gstin: "24BBBBB1111B1Z5",
        contactPerson: "", phone: "", email: "",
      },
      lines: [{
        label: "OZZO CRM + SFA", description: "Subscription · 5 users · 12 months",
        sac: "998314", users: 5, months: 12, rate: 400,
      }],
      discountPct: 0, discountAmount: 0, notes: "", terms: "Payment due within 7 days.",
    },
    ...overrides,
  };
}

describe("InvoiceDocument — GST variant", () => {
  test("is titled a tax invoice", () => {
    expect(text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />))).toContain("TAX INVOICE");
  });

  test("prints both GSTINs and the place of supply", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("24AAAAA0000A1Z5");
    expect(out).toContain("24BBBBB1111B1Z5");
    expect(out).toContain("Gujarat (24)");
  });

  test("prints CGST and SGST for an intra-state sale, and no IGST", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("CGST");
    expect(out).toContain("SGST");
    expect(out).not.toContain("IGST");
  });

  test("prints IGST only, for an inter-state sale", () => {
    const inter = row({
      gst_type: "interstate", place_of_supply_code: "27",
      cgst_amount: 0, sgst_amount: 0, igst_amount: 4320,
    });
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={inter} />));
    expect(out).toContain("IGST");
    expect(out).not.toContain("CGST");
  });

  test("prints the SAC code, the period and the amount in words", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("998314");
    expect(out).toContain("Rupees Twenty Eight Thousand Three Hundred Twenty Only");
  });

  test("prints the bank details so the customer can pay it", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row()} />));
    expect(out).toContain("50200012345678");
    expect(out).toContain("HDFC0001234");
  });

  test("a cancelled invoice says so on its face", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row({ status: "cancelled" })} />));
    expect(out).toContain("CANCELLED");
  });

  test("a draft is watermarked, so an unissued document is never mistaken for one", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={row({ status: "draft" })} />));
    expect(out).toContain("DRAFT");
  });
});

describe("InvoiceDocument — non-GST variant", () => {
  const nonGst = row({
    series: "non_gst", gst_enabled: false, gst_type: null, place_of_supply_code: null,
    gst_rate: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total: 24000,
  });

  test("is titled an invoice, not a tax invoice", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).toContain("INVOICE");
    expect(out).not.toContain("TAX INVOICE");
  });

  test("prints no GSTIN at all — neither ours nor theirs", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).not.toContain("24AAAAA0000A1Z5");
    expect(out).not.toContain("24BBBBB1111B1Z5");
    expect(out).not.toContain("GSTIN");
  });

  test("prints no tax row and no place of supply", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).not.toContain("CGST");
    expect(out).not.toContain("SGST");
    expect(out).not.toContain("IGST");
    expect(out).not.toContain("Place of Supply");
  });

  test("the total is the taxable value", () => {
    const out = text(renderToStaticMarkup(<InvoiceDocument invoice={nonGst} />));
    expect(out).toContain("Rupees Twenty Four Thousand Only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/invoices/template/invoice-document.test.tsx`
Expected: FAIL — cannot resolve `./invoice-document`.

- [ ] **Step 3: Write the document**

Create `src/lib/invoices/template/invoice-document.tsx` — a pure server-safe
component (no hooks, no `"use client"`), so the test above can render it.

Structure:

```tsx
// ============================================================
// The printable invoice. One component, two variants.
//
// Pure props in, markup out, with no hooks and no data fetching, so the
// variants are unit-testable: the GST one must print both GSTINs and the right
// pair of tax rows; the non-GST one must print no GSTIN and no tax anywhere.
//
// A4 at `size: A4; margin: 0`, like the proposal document. Every figure comes
// from the stored COLUMNS, never recomputed here: this renders the record.
// ============================================================

import { gstStateName } from "@/lib/gst/states";
import { formatCurrency } from "@/lib/currency";
import { amountInWords, lineAmount } from "../totals";
import type { InvoiceRow } from "../types";

export function InvoiceDocument({ invoice }: { invoice: InvoiceRow }) {
  const gst = invoice.gst_enabled;
  const { seller, buyer, lines } = invoice.data;
  const half = invoice.gst_rate / 2;
  // ...
}
```

Required content, top to bottom:

1. `<style>` block with `@page { size: A4; margin: 0 }`, `@media print` rules
   hiding `.print-hide`, and a `.sheet { width: 210mm; min-height: 297mm; padding: 12mm }`.
   Keep the colours plain (black text, grey rules) so it prints well without
   background graphics.
2. A header: the logo when `seller.logoUrl`, the firm name, address, pincode,
   phone, email; and on the right, the title — **TAX INVOICE** when `gst`, else
   **INVOICE**. When `invoice.status === "draft"` render a large rotated `DRAFT`
   watermark; when `"cancelled"`, `CANCELLED`.
3. Our details: PAN always; **GSTIN only when `gst`**.
4. A two-column party block: *Billed To* with the buyer's name, address,
   pincode, contact person; and, when `gst`, `GSTIN: <buyer.gstin>` and
   `Place of Supply: <gstStateName(invoice.place_of_supply_code)> (<code>)`.
   Opposite it, the invoice meta: number, date, Customer ID, plan, billing term,
   and `Service Period: <start> to <end>`.
5. The line table: `#`, Description (label + description), **SAC (only when
   `gst`)**, Users, Months, Rate, Amount — amounts via `formatCurrency(lineAmount(line))`.
6. The totals block, right-aligned: Subtotal; Discount when
   `invoice.discount_amount > 0`; Taxable Value; then **either** `CGST @ {half}%`
   and `SGST @ {half}%` **or** `IGST @ {invoice.gst_rate}%`, chosen on
   `invoice.gst_type`; then **Total**. Render each tax row only when its stored
   amount is non-zero, so a non-GST invoice cannot print a zero tax line.
7. `Amount in words: {amountInWords(invoice.total)}`.
8. Bank details (name, account number, IFSC, UPI) when any is set, the
   declaration, `invoice.data.terms`, and a signature block: the signature image
   when `seller.signatureUrl`, above `For {seller.firmName}` and
   `Authorised Signatory`.

Critical for the tests: the string "GSTIN" must not appear anywhere in the
non-GST variant, and "TAX INVOICE" must not appear in it — so the title is a
single conditional string, not "TAX " + "INVOICE" assembled from parts.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/invoices/template/invoice-document.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the print route**

`src/app/print/invoice/[id]/download-button.tsx` — copy
`src/app/print/proposal/[id]/download-button.tsx` verbatim, changing only the
label to "Download PDF" and the hint to mention A4.

`src/app/print/invoice/[id]/page.tsx`:

```tsx
// ============================================================
// The printable invoice. FOUNDER-ONLY.
//
// Unlike /print/order and /print/quotation, which are tenant documents behind
// RLS, this one carries OZZO's own billing and is gated on the session the same
// way /print/proposal is: requireFounder(), and notFound() for anyone else.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { InvoiceDocument } from "@/lib/invoices/template/invoice-document";
import type { InvoiceRow } from "@/lib/invoices/types";
import { DownloadButton } from "./download-button";

export const metadata: Metadata = { title: "Invoice" };

async function loadInvoice(id: string): Promise<InvoiceRow | null> {
  try {
    await requireFounder();
  } catch {
    return null;
  }

  const { data } = await serviceClient()
    .from("platform_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data as InvoiceRow | null) ?? null;
}

export default async function PrintInvoicePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const invoice = await loadInvoice(id);
  if (!invoice) notFound();

  return (
    <>
      <DownloadButton />
      <InvoiceDocument invoice={invoice} />
    </>
  );
}
```

- [ ] **Step 6: Verify the real print output**

Run: `npm run typecheck && npm run build`

Then open `/print/invoice/<a real id>` in the preview and check, by eye:
- the GST invoice fills one A4 page with nothing cut off at the right margin;
- CGST and SGST appear for an intra-state invoice, IGST for an inter-state one;
- the non-GST invoice shows no GSTIN and no tax rows;
- Chrome's print dialog produces a single-page PDF.

Sign out, or open the URL as a non-founder superadmin, and confirm a 404.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoices/template "src/app/print/invoice"
git commit -m "$(cat <<'EOF'
Add the printable invoice, GST and non-GST

One pure component with two variants, which is what makes them testable: the
GST one prints both GSTINs, the place of supply, SAC codes and either the
CGST/SGST pair or IGST; the non-GST one prints no GSTIN and no tax row
anywhere, and is titled Invoice rather than Tax Invoice. A draft or a
cancelled invoice is watermarked, so an unissued document cannot be mistaken
for a real one.

The route is founder-gated on the session, not left to RLS: unlike the order
and quotation print views, this document is OZZO's own billing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Ship it

**Files:**
- Modify: `PROJECT.md` — a short section on the module

- [ ] **Step 1: Run the whole suite**

```bash
npm test
npm run typecheck
npm run build
```

Paste the real output of all three. If anything fails, fix it before going on —
do not report a clean run you did not see.

- [ ] **Step 2: Document the module in PROJECT.md**

Add a section after the existing superadmin notes, covering: the two tables and
their founder-only RLS posture; that `src/lib/invoices/*` is pure and holds all
money, tax, numbering and status rules; that the discount is applied once, in
`invoiceTotals()`, and `quote()` is called with `discountPct: 0`; that an issued
invoice is frozen and cancelled rather than deleted; and that
`/print/invoice/[id]` is founder-gated on the session, not by RLS.

- [ ] **Step 3: Commit and push**

```bash
git add PROJECT.md
git commit -m "$(cat <<'EOF'
Document the invoice module in PROJECT.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 4: Tell the founder what he has to do**

In plain words, three things:
1. Run `supabase/migrations/20261020120000_platform_invoices.sql` by hand on the
   Mumbai project. Nothing works before that.
2. Open `/admin/invoice-settings` and fill in the firm name, address, state,
   GSTIN, PAN, bank details and signature image.
3. If he has already issued invoices this financial year outside OZZO, set the
   starting numbers in the same screen before raising the first invoice.

Give him the commit hashes.

---

# Self-Review

**Spec coverage.** Every section of the spec maps to a task: tables and RLS →
Task 1; the six pure libraries → Tasks 2–7 (the spec listed five plus
`denormalise`, which it described inside the API behaviour — it is Task 7 here);
Invoice Settings → Tasks 8 and 11; list/create and one-invoice APIs → Tasks 9
and 10; the list screen and nav → Task 12; the form, pre-fill, period and live
totals → Task 13; detail, status actions and WhatsApp → Task 14; the A4 print
template and its founder gate → Task 15; migration hand-over, docs and push →
Tasks 1 and 16.

**Two deliberate deviations from the spec**, both improvements found while
reading the code:

1. The spec said `lib/invoices/gst.ts` would hold the intra/inter-state rule.
   `determineGstType()` already exists in `src/lib/gst/states.ts` and is the TS
   mirror of the SQL the Orders module persists with, so Task 4's `tax.ts` holds
   only the arithmetic and the place-of-supply resolution. One rule, one place.
2. The spec said `lib/renewals/buckets.ts` would define `todayInIST()`.
   `todayInIndia()` already exists in `src/lib/proposals/today.ts` with the same
   `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })` implementation
   and its own tests, so it is reused — in this plan at Tasks 9, 10 and 14, and
   in the renewals plan throughout.

**Type consistency.** `InvoiceStatus`, `InvoiceSeries`, `InvoiceLine`,
`InvoiceData`, `SellerSnapshot`, `BuyerSnapshot`, `InvoiceRow` and `DEFAULT_SAC`
are defined once in Task 2 and imported by name everywhere after.
`invoiceTotals()` returns `taxTotal`, used under that name in Tasks 5, 13 and
15. `invoiceColumns()` and `planLine()` are defined in Task 7 and called in
Tasks 9, 10 and 13 with those exact signatures. `resolveNumber()` is exported
from the list route in Task 9 and imported by the `[id]` route in Task 10.
`statusPatch(to, amountReceived, total, today)` keeps that argument order in
Tasks 6 and 10.

**Figures verified against the catalogue, not assumed.** `PLAN_PRICE.CRM_SFA`
is 400 (`src/lib/plans/catalog.ts:59`), so the worked example used throughout —
5 users × 12 months × ₹400 = ₹24,000 taxable, CGST and SGST ₹2,160 each, total
₹28,320, "Rupees Twenty Eight Thousand Three Hundred Twenty Only" — is the real
arithmetic, and the quarterly rate of ₹560 is 400 × 1.40. The ₹2,430 / ₹31,860
figures in Task 5 follow from the same rate after a 10% discount.

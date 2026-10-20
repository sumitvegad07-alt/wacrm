# Platform Subscription Renewals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the founder one screen he opens each morning that says exactly whose subscription ends today, who is overdue, and who is due in the next week or month — with the salesman, the amount and the contact on the row, and a Renew action that keeps every past period.

**Architecture:** Two founder-only tables the founder maintains by hand: `platform_subscriptions` holds the current period per customer, `platform_subscription_periods` holds its history. One SQL function archives-and-advances atomically. All day bucketing is a pure function over `yyyy-mm-dd` strings compared against today in `Asia/Kolkata`, computed on the server — never from the browser clock. Reads and writes go through `/api/admin/renewals*` behind `requireFounder()` using `serviceClient()`.

**Tech Stack:** Next.js 16 App Router (`src/app/`), React 19, TypeScript strict, Supabase/Postgres, Tailwind + shadcn/ui, `sonner` toasts, `lucide-react` icons, vitest (`environment: node`).

**Spec:** [`docs/superpowers/specs/2026-10-20-invoice-and-renewal-modules-design.md`](../specs/2026-10-20-invoice-and-renewal-modules-design.md) — Part 2.

## Global Constraints

- **This module has NO link to invoices.** The founder's explicit instruction: it "does not have any relation with invoice module". Renewing must not create an invoice, must not read `platform_invoices`, and must not import anything from `src/lib/invoices/`. If a task seems to need one, it is the wrong task.
- **It reads nothing from `accounts` either.** Every row is typed by the founder. No auto-creation, no sync, no join. `customer_id` is free text, so a customer who is not yet a tenant can still be tracked.
- **Founder-only, everywhere.** Every API route calls `requireFounder()` from `@/lib/auth/superadmin` before touching `serviceClient()`. The page calls `requireFounder()` and `notFound()` on throw, matching `src/app/(superadmin)/admin/proposals/page.tsx`.
- **New tables have RLS enabled with NO policies**, plus `revoke all ... from anon, authenticated`, and the RPC's execute right revoked from both. Copy the comment discipline of `supabase/migrations/20260926120000_platform_proposals.sql`.
- **Dates are account-local, and "today" is IST, resolved on the server.** Use `todayInIndia()` from `@/lib/proposals/today`. **Never `toISOString()` for a day boundary.** Compare `yyyy-mm-dd` strings against the `date` columns; never pass a date-only string through `Date` to compare it. The attendance tabs have a live bug of exactly this kind — do not reproduce it here.
- **Terms come from `@/lib/plans/pricing`:** `BILLING_TERMS`, `TERM_LABEL`, `TERM_MONTHS` (3 / 6 / 12), `asTerm()`. Never re-list them.
- **No `any` without a justifying comment.** TypeScript is strict. Type the row shapes.
- **Tests live beside the code** as `src/**/*.test.ts` and run with `npm test`. A `*.spec.ts` is NOT picked up by vitest here.
- **The migration is applied BY HAND by the founder.** The Supabase MCP cannot reach the Mumbai project (permission denied since 2026-10-16). Task 1 ends by handing the SQL over; the screen stays dead until it runs.
- **Commit style is this repo's**, not conventional commits: a sentence-case imperative line saying what changed and why it mattered, then a blank line and the body. End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Push to `main` directly.** No branches, no PRs — Vercel deploys `main`.
- **Never expose this to a tenant.** No plan gating entry, no rights-registry entry, no mobile surface, no nav link outside the founder-only list.
- **Report real command output.** Run `npm test`, `npm run typecheck` and `npm run build` and paste what they actually printed.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261020130000_platform_subscriptions.sql` | Both tables, indexes, the renew RPC, touch trigger, RLS + revokes |
| `supabase/migrations/ROLLBACK-platform-subscriptions.md` | The drops, in order |
| `src/lib/renewals/types.ts` | `RenewalStatus`, `SubscriptionRow`, `PeriodRow`, `RenewalBucket`, the status labels |
| `src/lib/renewals/buckets.ts` + `.test.ts` | `daysUntil`, `bucketOf`, `isDue`, `bucketCounts` — **all** day arithmetic |
| `src/lib/renewals/next-period.ts` + `.test.ts` | The next period's start and end, from the current end and a term |
| `src/app/api/admin/renewals/route.ts` | GET list (optionally bucketed), POST create |
| `src/app/api/admin/renewals/[id]/route.ts` | GET one + its history, PATCH, DELETE |
| `src/app/api/admin/renewals/[id]/renew/route.ts` | POST → the renew RPC |
| `src/app/(superadmin)/admin/renewals/page.tsx` | Founder guard |
| `src/app/(superadmin)/admin/renewals/renewals-client.tsx` | Tabs, tiles, table |
| `src/app/(superadmin)/admin/renewals/subscription-form.tsx` | Add / edit dialog |
| `src/app/(superadmin)/admin/renewals/renew-dialog.tsx` | The renew action + history |
| `src/app/(superadmin)/admin/admin-shell.tsx` (modify) | One nav entry |

`buckets.ts` imports nothing but `todayInIndia`: it is the module where an
off-by-one silently tells the founder nobody is due today, so it must be
testable with a fake clock and no database.

---

## Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261020130000_platform_subscriptions.sql`
- Create: `supabase/migrations/ROLLBACK-platform-subscriptions.md`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.platform_subscriptions`, `public.platform_subscription_periods`; function `public.renew_platform_subscription(p_id uuid, p_plan text, p_billing_term text, p_users integer, p_amount numeric, p_start_date date, p_end_date date, p_renewed_by uuid) returns public.platform_subscriptions`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261020130000_platform_subscriptions.sql`:

```sql
-- ============================================================
-- platform_subscriptions — the founder's own renewal register.
--
-- Platform data, not tenant data: RLS enabled with NO policies, nothing granted
-- to anon/authenticated, reached only through /api/admin/renewals behind
-- requireFounder() with the service-role key. Same posture as
-- platform_proposals (migration 20260926120000).
--
-- DELIBERATELY NOT DERIVED FROM `accounts`. The founder maintains these rows by
-- hand, because the platform tracks no salesman, no subscription start date and
-- no renewal amount, and because deriving them would keep re-creating rows for
-- test and dead tenants. `customer_id` is free text, not a foreign key, so a
-- customer who is not yet a tenant in the app can still be tracked.
--
-- This module has NO relationship to platform_invoices. Renewing does not raise
-- an invoice and paying an invoice does not move a date here. That separation is
-- the founder's instruction, not an oversight.
-- ============================================================

create table if not exists public.platform_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     text not null default '',
  company_name    text not null,
  -- Free text with a picker in the UI: a legacy or custom package has to be
  -- recordable, and this register is the founder's book, not the entitlement
  -- system.
  plan            text not null default '',
  billing_term    text,
  users           integer not null default 0,
  amount          numeric(12,2) not null default 0,
  start_date      date not null,
  end_date        date not null,
  salesman_name   text not null default '',
  contact_person  text not null default '',
  phone           text not null default '',
  status          text not null default 'active',
  remarks         text not null default '',
  follow_up_date  date,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint platform_subscriptions_term_check
    check (billing_term is null or billing_term in ('quarterly', 'half_yearly', 'yearly')),
  constraint platform_subscriptions_status_check
    check (status in ('active', 'renewed', 'in_discussion', 'lost', 'on_hold')),
  constraint platform_subscriptions_dates_check
    check (end_date >= start_date)
);

comment on table public.platform_subscriptions is
  'The founder''s renewal register (founder-only), maintained by hand. RLS denies all; access via /api/admin/renewals with the service role. Unrelated to platform_invoices by design.';

-- The daily screen's only hot filter: "whose end_date is today".
create index if not exists platform_subscriptions_end_date_idx
  on public.platform_subscriptions (end_date);
create index if not exists platform_subscriptions_status_idx
  on public.platform_subscriptions (status);
create index if not exists platform_subscriptions_company_idx
  on public.platform_subscriptions (company_name);

-- ------------------------------------------------------------
-- Every period that has already been served, so the row can move forward
-- without losing what came before.
-- ------------------------------------------------------------
create table if not exists public.platform_subscription_periods (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references public.platform_subscriptions(id) on delete cascade,
  plan            text not null default '',
  billing_term    text,
  users           integer not null default 0,
  amount          numeric(12,2) not null default 0,
  start_date      date not null,
  end_date        date not null,
  renewed_at      timestamptz not null default now(),
  renewed_by      uuid references auth.users(id) on delete set null
);

comment on table public.platform_subscription_periods is
  'Past periods of a platform subscription (founder-only). Written by renew_platform_subscription(); never edited.';

create index if not exists platform_subscription_periods_sub_idx
  on public.platform_subscription_periods (subscription_id, start_date desc);

-- ------------------------------------------------------------
-- Archive-and-advance, in one statement's worth of atomicity.
--
-- Two separate writes from the API would leave a renewal half-done if the
-- second failed: the row moved forward with no history, or history written
-- twice on a retry. The row is locked FOR UPDATE so two clicks cannot both
-- archive the same period.
-- ------------------------------------------------------------
create or replace function public.renew_platform_subscription(
  p_id           uuid,
  p_plan         text,
  p_billing_term text,
  p_users        integer,
  p_amount       numeric,
  p_start_date   date,
  p_end_date     date,
  p_renewed_by   uuid
)
returns public.platform_subscriptions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.platform_subscriptions;
begin
  select * into v_row
    from public.platform_subscriptions
    where id = p_id
    for update;

  if not found then
    raise exception 'Subscription % not found', p_id;
  end if;

  if p_end_date < p_start_date then
    raise exception 'The new period ends (%) before it starts (%)', p_end_date, p_start_date;
  end if;

  insert into public.platform_subscription_periods (
    subscription_id, plan, billing_term, users, amount, start_date, end_date, renewed_by
  ) values (
    p_id, v_row.plan, v_row.billing_term, v_row.users, v_row.amount,
    v_row.start_date, v_row.end_date, p_renewed_by
  );

  update public.platform_subscriptions set
    -- coalesce: an omitted field keeps what the row already had, so a renewal
    -- that only moves the dates does not blank the plan or the amount.
    plan         = coalesce(p_plan, plan),
    billing_term = coalesce(p_billing_term, billing_term),
    users        = coalesce(p_users, users),
    amount       = coalesce(p_amount, amount),
    start_date   = p_start_date,
    end_date     = p_end_date,
    status       = 'active'
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.renew_platform_subscription is
  'Archives the current period into platform_subscription_periods and advances the row. Called by /api/admin/renewals/[id]/renew with the service role.';

create or replace function public.touch_platform_subscriptions_updated_at()
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

drop trigger if exists platform_subscriptions_touch_updated_at on public.platform_subscriptions;
create trigger platform_subscriptions_touch_updated_at
  before update on public.platform_subscriptions
  for each row execute function public.touch_platform_subscriptions_updated_at();

-- ------------------------------------------------------------
-- RLS on, deliberately no policies. Do not add one.
-- ------------------------------------------------------------
alter table public.platform_subscriptions enable row level security;
alter table public.platform_subscription_periods enable row level security;

revoke all on public.platform_subscriptions from anon, authenticated;
revoke all on public.platform_subscription_periods from anon, authenticated;

-- The function is SECURITY INVOKER, so a tenant calling it would hit the same
-- empty policy set — but revoking execute means they cannot even reach it.
revoke all on function public.renew_platform_subscription(
  uuid, text, text, integer, numeric, date, date, uuid
) from anon, authenticated;
```

- [ ] **Step 2: Write the rollback note**

Create `supabase/migrations/ROLLBACK-platform-subscriptions.md`:

````markdown
# Rollback — platform subscriptions (20261020130000)

Founder-only data, typed by hand and held nowhere else — there is no `accounts`
column to rebuild it from. Export both tables first:

```sql
\copy (select * from public.platform_subscriptions order by end_date) to 'platform_subscriptions.csv' csv header
\copy (select * from public.platform_subscription_periods order by subscription_id, start_date) to 'platform_subscription_periods.csv' csv header
```

Then, in order:

```sql
drop trigger if exists platform_subscriptions_touch_updated_at on public.platform_subscriptions;
drop function if exists public.renew_platform_subscription(uuid, text, text, integer, numeric, date, date, uuid);
drop function if exists public.touch_platform_subscriptions_updated_at();
drop table if exists public.platform_subscription_periods;
drop table if exists public.platform_subscriptions;
```

`platform_subscription_periods` goes first: it carries the foreign key.
````

- [ ] **Step 3: Check the SQL by eye**

There is no local Postgres here, so this is a careful read, not a run. Verify:
- the `returns public.platform_subscriptions` type matches the table name exactly;
- `for update` is present on the `select` inside the function;
- the `revoke ... on function` signature lists the eight argument types in the same order as the definition;
- no `create policy` anywhere in the file;
- all three `revoke` statements are present.

Do NOT claim the migration has been applied or tested against a database.

- [ ] **Step 4: Commit and hand over**

```bash
git add supabase/migrations/20261020130000_platform_subscriptions.sql supabase/migrations/ROLLBACK-platform-subscriptions.md
git commit -m "$(cat <<'EOF'
Add the platform_subscriptions tables for the renewal register

Two founder-only tables: the current period per customer, and every period
already served. RLS is enabled with no policies and nothing is granted to
anon or authenticated, so the only way in is the service role behind
requireFounder().

renew_platform_subscription() archives and advances in one transaction with
the row locked: two separate writes from the API would leave a renewal
half-done if the second failed, or write history twice on a retry.

Deliberately derived from nothing. The founder types these rows, because the
platform tracks no salesman, no subscription start date and no renewal
amount — and syncing from accounts would keep resurrecting rows for test and
dead tenants.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Then tell the founder: this SQL has to be run by hand on the Mumbai project
before `/admin/renewals` will load.

---

## Task 2: Types and day bucketing

**Files:**
- Create: `src/lib/renewals/types.ts`
- Create: `src/lib/renewals/buckets.ts`
- Test: `src/lib/renewals/buckets.test.ts`

**Interfaces:**
- Consumes: `todayInIndia` from `@/lib/proposals/today`; `BillingTerm` from `@/lib/plans/pricing`.
- Produces: `RenewalStatus`, `RENEWAL_STATUSES`, `RENEWAL_STATUS_LABEL`, `SubscriptionRow`, `PeriodRow`, `RenewalBucket`, `BUCKETS`, `BUCKET_LABEL`; `daysUntil(endDate: string, today?: string): number | null`; `bucketOf(row: Pick<SubscriptionRow, "end_date" | "status">, today?: string): RenewalBucket | null`; `inBucket(row, bucket, today?): boolean`; `bucketSummary(rows, today?)`.

- [ ] **Step 1: Write the types**

Create `src/lib/renewals/types.ts`:

```ts
// ============================================================
// Types for the founder's renewal register.
//
// Nothing here is shared with the invoice module, on purpose: the two have no
// relationship, and a type import between them would be the first step towards
// one.
// ============================================================

import type { BillingTerm } from "@/lib/plans/pricing";

export const RENEWAL_STATUSES = [
  "active",
  "renewed",
  "in_discussion",
  "lost",
  "on_hold",
] as const;

export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const RENEWAL_STATUS_LABEL: Record<RenewalStatus, string> = {
  active: "Active",
  renewed: "Renewed",
  in_discussion: "In Discussion",
  lost: "Lost",
  on_hold: "On Hold",
};

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  company_name: string;
  plan: string;
  billing_term: BillingTerm | null;
  users: number;
  amount: number;
  /** yyyy-mm-dd. A `date` column — never parse it through `Date` to compare. */
  start_date: string;
  end_date: string;
  salesman_name: string;
  contact_person: string;
  phone: string;
  status: RenewalStatus;
  remarks: string;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodRow {
  id: string;
  subscription_id: string;
  plan: string;
  billing_term: BillingTerm | null;
  users: number;
  amount: number;
  start_date: string;
  end_date: string;
  renewed_at: string;
}

/** The tabs on the daily screen, in the order they appear. */
export const BUCKETS = ["today", "overdue", "next_7", "next_30", "all"] as const;

export type RenewalBucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<RenewalBucket, string> = {
  today: "Due Today",
  overdue: "Overdue",
  next_7: "Next 7 Days",
  next_30: "Next 30 Days",
  all: "All",
};
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/renewals/buckets.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { bucketOf, bucketSummary, daysUntil, inBucket } from "./buckets";
import type { SubscriptionRow } from "./types";

// ---------------------------------------------------------------------------
// This is the module the whole screen rests on: if "today" is off by one, the
// founder opens the screen and is told nobody is due. Every test here passes
// `today` explicitly, which is also how the server calls it — so the result can
// never depend on the machine's own clock or timezone.
// ---------------------------------------------------------------------------

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "s1", customer_id: "001001", company_name: "Shree Narmada Masala",
    plan: "CRM_SFA", billing_term: "yearly", users: 5, amount: 24000,
    start_date: "2025-10-20", end_date: "2026-10-20", salesman_name: "Ravi",
    contact_person: "", phone: "", status: "active", remarks: "",
    follow_up_date: null, created_at: "", updated_at: "",
    ...overrides,
  };
}

const TODAY = "2026-10-20";

describe("daysUntil", () => {
  test("today is zero", () => {
    expect(daysUntil("2026-10-20", TODAY)).toBe(0);
  });

  test("tomorrow is one, yesterday is minus one", () => {
    expect(daysUntil("2026-10-21", TODAY)).toBe(1);
    expect(daysUntil("2026-10-19", TODAY)).toBe(-1);
  });

  test("it counts across a month end", () => {
    expect(daysUntil("2026-11-01", TODAY)).toBe(12);
  });

  test("it counts across a year end", () => {
    expect(daysUntil("2027-01-01", "2026-12-25")).toBe(7);
  });

  test("it counts across a leap day", () => {
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
  });

  test("a blank or malformed date is null, never a number", () => {
    expect(daysUntil("", TODAY)).toBeNull();
    expect(daysUntil("not-a-date", TODAY)).toBeNull();
  });
});

describe("bucketOf", () => {
  test("an end date of today is due today", () => {
    expect(bucketOf(row({ end_date: TODAY }), TODAY)).toBe("today");
  });

  test("a past end date is overdue", () => {
    expect(bucketOf(row({ end_date: "2026-10-19" }), TODAY)).toBe("overdue");
    expect(bucketOf(row({ end_date: "2025-01-01" }), TODAY)).toBe("overdue");
  });

  test("tomorrow through seven days out is next_7", () => {
    expect(bucketOf(row({ end_date: "2026-10-21" }), TODAY)).toBe("next_7");
    expect(bucketOf(row({ end_date: "2026-10-27" }), TODAY)).toBe("next_7");
  });

  test("eight through thirty days out is next_30", () => {
    expect(bucketOf(row({ end_date: "2026-10-28" }), TODAY)).toBe("next_30");
    expect(bucketOf(row({ end_date: "2026-11-19" }), TODAY)).toBe("next_30");
  });

  test("further out than thirty days is in no due bucket", () => {
    expect(bucketOf(row({ end_date: "2026-12-31" }), TODAY)).toBeNull();
  });

  test("a lost customer is in no due bucket, however their date reads", () => {
    // They are not coming back; putting them in today's list is noise in the
    // one place that has to be actionable. They stay visible under All.
    expect(bucketOf(row({ end_date: TODAY, status: "lost" }), TODAY)).toBeNull();
    expect(bucketOf(row({ end_date: "2025-01-01", status: "lost" }), TODAY)).toBeNull();
  });

  test("an on-hold or in-discussion customer is still due", () => {
    expect(bucketOf(row({ end_date: TODAY, status: "on_hold" }), TODAY)).toBe("today");
    expect(bucketOf(row({ end_date: TODAY, status: "in_discussion" }), TODAY)).toBe("today");
  });
});

describe("inBucket", () => {
  test("the next_7 tab includes today and the overdue", () => {
    // The tab answers "what needs chasing this week", so it cannot hide
    // something that was already due on Monday.
    expect(inBucket(row({ end_date: TODAY }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-19" }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-27" }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-28" }), "next_7", TODAY)).toBe(false);
  });

  test("the next_30 tab includes everything up to thirty days out", () => {
    expect(inBucket(row({ end_date: "2026-11-19" }), "next_30", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-11-20" }), "next_30", TODAY)).toBe(false);
  });

  test("the today tab is only today", () => {
    expect(inBucket(row({ end_date: TODAY }), "today", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-19" }), "today", TODAY)).toBe(false);
  });

  test("the overdue tab is only the past", () => {
    expect(inBucket(row({ end_date: "2026-10-19" }), "overdue", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: TODAY }), "overdue", TODAY)).toBe(false);
  });

  test("the all tab holds everything, lost customers included", () => {
    expect(inBucket(row({ end_date: "2030-01-01" }), "all", TODAY)).toBe(true);
    expect(inBucket(row({ status: "lost" }), "all", TODAY)).toBe(true);
  });
});

describe("bucketSummary", () => {
  const rows = [
    row({ id: "a", end_date: TODAY, amount: 24000 }),
    row({ id: "b", end_date: "2026-10-19", amount: 10000 }),
    row({ id: "c", end_date: "2026-10-25", amount: 5000 }),
    row({ id: "d", end_date: "2026-10-31", amount: 7000 }),
    row({ id: "e", end_date: TODAY, amount: 99999, status: "lost" }),
  ];

  test("counts and rupee values per bucket", () => {
    const s = bucketSummary(rows, TODAY);
    expect(s.today).toEqual({ count: 1, amount: 24000 });
    expect(s.overdue).toEqual({ count: 1, amount: 10000 });
  });

  test("the week and month tiles are cumulative, like the tabs", () => {
    const s = bucketSummary(rows, TODAY);
    // overdue + today + within 7 days: b, a, c
    expect(s.next_7).toEqual({ count: 3, amount: 39000 });
    // plus d, inside 30 days
    expect(s.next_30).toEqual({ count: 4, amount: 46000 });
  });

  test("a lost customer is counted nowhere but All", () => {
    const s = bucketSummary(rows, TODAY);
    expect(s.all.count).toBe(5);
    expect(s.today.amount).toBe(24000); // not 123,999
  });

  test("no rows is zeroes, not NaN", () => {
    const s = bucketSummary([], TODAY);
    expect(s.today).toEqual({ count: 0, amount: 0 });
    expect(s.all).toEqual({ count: 0, amount: 0 });
  });
});

describe("the IST day boundary", () => {
  // The bug this guards: Vercel runs in UTC, so at 23:40 IST the UTC date is
  // still yesterday. A screen that asks "who is due today" from the server
  // clock would answer with yesterday's list for the last 5½ hours of every
  // day — and with tomorrow's for the first 5½ hours if read the other way.
  test("late evening IST still reads today's date, not yesterday's", () => {
    // 2026-10-20 23:40 IST == 2026-10-20 18:10 UTC
    const lateEvening = new Date("2026-10-20T18:10:00Z");
    expect(daysUntil("2026-10-20", undefined, lateEvening)).toBe(0);
  });

  test("just after midnight IST reads the new date, not the old one", () => {
    // 2026-10-21 00:10 IST == 2026-10-20 18:40 UTC
    const justAfterMidnight = new Date("2026-10-20T18:40:00Z");
    expect(daysUntil("2026-10-21", undefined, justAfterMidnight)).toBe(0);
    expect(daysUntil("2026-10-20", undefined, justAfterMidnight)).toBe(-1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/renewals/buckets.test.ts`
Expected: FAIL — cannot resolve `./buckets`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/renewals/buckets.ts`:

```ts
// ============================================================
// All of the renewal screen's day arithmetic, in one testable place.
//
// Two rules hold everything together:
//
//   1. "Today" is Asia/Kolkata, resolved through todayInIndia(). Vercel runs in
//      UTC, so at 23:40 IST the server's own date is still yesterday — a screen
//      built on it would show yesterday's due list for the last 5½ hours of
//      every day.
//   2. A date-only value is compared as a yyyy-mm-dd STRING, or as a UTC-noon
//      instant when a day count is needed. Never `new Date("2026-10-20")`
//      compared against a local `Date`: that mixes a UTC midnight with a local
//      one and shifts the answer by a day in either direction.
//
// The tabs are CUMULATIVE on purpose. "Next 7 days" answers "what needs chasing
// this week", so it includes today and anything already overdue — a renewal
// that lapsed on Monday must not vanish from the week's list.
// ============================================================

import { todayInIndia } from "@/lib/proposals/today";
import type { RenewalBucket, SubscriptionRow } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date-only string as a UTC-noon instant: far from any day boundary. */
function utcNoon(date: string): number | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole days from today to `endDate`: 0 today, 1 tomorrow, −1 yesterday.
 *
 * `today` is normally supplied by the caller (the API resolves it once per
 * request). `now` exists so a test can pin the clock without mocking Date.
 */
export function daysUntil(
  endDate: string,
  today?: string,
  now: Date = new Date(),
): number | null {
  const end = utcNoon(endDate);
  const start = utcNoon(today ?? todayInIndia(now));
  if (end === null || start === null) return null;

  return Math.round((end - start) / 86_400_000);
}

/**
 * The narrowest bucket a row belongs to, or null when it is not due soon.
 *
 * A `lost` customer is in no due bucket however their date reads: they are not
 * coming back, and the one screen that has to be actionable each morning should
 * not carry them. They stay visible under the All tab.
 */
export function bucketOf(
  row: Pick<SubscriptionRow, "end_date" | "status">,
  today?: string,
  now: Date = new Date(),
): RenewalBucket | null {
  if (row.status === "lost") return null;

  const days = daysUntil(row.end_date, today, now);
  if (days === null) return null;

  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "next_7";
  if (days <= 30) return "next_30";
  return null;
}

/** Whether a row belongs on a given tab. The due tabs are cumulative. */
export function inBucket(
  row: Pick<SubscriptionRow, "end_date" | "status">,
  bucket: RenewalBucket,
  today?: string,
  now: Date = new Date(),
): boolean {
  if (bucket === "all") return true;
  if (row.status === "lost") return false;

  const days = daysUntil(row.end_date, today, now);
  if (days === null) return false;

  switch (bucket) {
    case "overdue":
      return days < 0;
    case "today":
      return days === 0;
    case "next_7":
      return days <= 7;
    case "next_30":
      return days <= 30;
  }
}

export interface BucketFigure {
  count: number;
  amount: number;
}

/** The tiles above the table: a count and a rupee value for every tab. */
export function bucketSummary(
  rows: SubscriptionRow[],
  today?: string,
  now: Date = new Date(),
): Record<RenewalBucket, BucketFigure> {
  const blank = (): BucketFigure => ({ count: 0, amount: 0 });
  const out: Record<RenewalBucket, BucketFigure> = {
    today: blank(),
    overdue: blank(),
    next_7: blank(),
    next_30: blank(),
    all: blank(),
  };

  for (const row of rows ?? []) {
    const amount = Number(row.amount) || 0;

    out.all.count += 1;
    out.all.amount += amount;

    for (const bucket of ["overdue", "today", "next_7", "next_30"] as const) {
      if (inBucket(row, bucket, today, now)) {
        out[bucket].count += 1;
        out[bucket].amount += amount;
      }
    }
  }

  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/renewals/buckets.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/renewals/types.ts src/lib/renewals/buckets.ts src/lib/renewals/buckets.test.ts
git commit -m "$(cat <<'EOF'
Add the renewal day bucketing, in IST

"Today" is resolved through todayInIndia(), not the server clock: Vercel
runs in UTC, so at 23:40 IST the server's own date is still yesterday, and a
screen built on it would show yesterday's due list for the last five and a
half hours of every day. Two tests pin exactly that boundary from both
sides.

Date-only values are compared at UTC noon rather than parsed as local dates,
so a day count can never be shifted by a timezone. The due tabs are
cumulative on purpose — a renewal that lapsed on Monday must not drop out of
this week's list — and a lost customer is counted nowhere but All.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The next period

**Files:**
- Create: `src/lib/renewals/next-period.ts`
- Test: `src/lib/renewals/next-period.test.ts`

**Interfaces:**
- Consumes: `BillingTerm`, `TERM_MONTHS`, `asTerm` from `@/lib/plans/pricing`.
- Produces: `nextPeriod(currentEnd: string, term: BillingTerm | null): { start: string; end: string }`; `periodEnd(start: string, term: BillingTerm | null): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/renewals/next-period.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { nextPeriod, periodEnd } from "./next-period";

// ---------------------------------------------------------------------------
// A period ends the day BEFORE the next one starts. Getting that wrong by a day
// either double-bills a day or leaves a gap, and the gap is what makes a
// customer appear overdue when they are not.
// ---------------------------------------------------------------------------

describe("periodEnd", () => {
  test("a yearly period starting 1 Nov ends 31 Oct", () => {
    expect(periodEnd("2026-11-01", "yearly")).toBe("2027-10-31");
  });

  test("a quarterly period runs three months", () => {
    expect(periodEnd("2026-11-01", "quarterly")).toBe("2027-01-31");
  });

  test("a half-yearly period runs six months", () => {
    expect(periodEnd("2026-11-01", "half_yearly")).toBe("2027-04-30");
  });

  test("a period starting mid-month ends mid-month", () => {
    expect(periodEnd("2026-10-15", "yearly")).toBe("2027-10-14");
  });

  test("a 31st start lands on the last day of a shorter month", () => {
    // 31 Jan + 3 months must not overflow into May.
    expect(periodEnd("2026-01-31", "quarterly")).toBe("2026-04-30");
  });

  test("a leap year is handled", () => {
    expect(periodEnd("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  test("no term reads as yearly, the base term", () => {
    expect(periodEnd("2026-11-01", null)).toBe("2027-10-31");
  });

  test("a blank start date is blank, never an invalid date", () => {
    expect(periodEnd("", "yearly")).toBe("");
  });
});

describe("nextPeriod", () => {
  test("the next period starts the day after the current one ends", () => {
    expect(nextPeriod("2026-10-20", "yearly")).toEqual({
      start: "2026-10-21",
      end: "2027-10-20",
    });
  });

  test("it rolls over a month end", () => {
    expect(nextPeriod("2026-10-31", "quarterly")).toEqual({
      start: "2026-11-01",
      end: "2027-01-31",
    });
  });

  test("it rolls over a year end", () => {
    expect(nextPeriod("2026-12-31", "yearly")).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });

  test("the two periods never overlap and never leave a gap", () => {
    const { start } = nextPeriod("2026-10-20", "yearly");
    expect(start).toBe("2026-10-21");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/renewals/next-period.test.ts`
Expected: FAIL — cannot resolve `./next-period`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/renewals/next-period.ts`:

```ts
// ============================================================
// Where the next period starts and ends.
//
// A period ENDS THE DAY BEFORE the next one begins: a yearly term from 1 Nov
// 2026 ends 31 Oct 2027, not 1 Nov. Off by a day in one direction double-bills
// a day; in the other it leaves a gap, and the gap is what makes a paid-up
// customer show as overdue.
//
// Month arithmetic is done in UTC with an explicit clamp, so a 31 January start
// plus three months lands on 30 April rather than overflowing into May — which
// is what `setMonth` does on its own.
// ============================================================

import { asTerm, TERM_MONTHS, type BillingTerm } from "@/lib/plans/pricing";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: string): [number, number, number] | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function iso(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Days in a given month, 1-indexed. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(date: string, months: number): string | null {
  const p = parts(date);
  if (!p) return null;
  const [y, m, d] = p;

  const zero = m - 1 + months;
  const year = y + Math.floor(zero / 12);
  const month = (((zero % 12) + 12) % 12) + 1;

  // Clamp rather than overflow: 31 Jan + 1 month is 28 Feb, not 3 March.
  const day = Math.min(d, daysInMonth(year, month));
  return iso(year, month, day);
}

function addDays(date: string, days: number): string | null {
  const p = parts(date);
  if (!p) return null;
  const [y, m, d] = p;

  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return iso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The last day of a period that starts on `start` and runs one whole term. */
export function periodEnd(start: string, term: BillingTerm | null): string {
  const months = TERM_MONTHS[asTerm(term)];
  const sameDayNextTerm = addMonths(start, months);
  if (!sameDayNextTerm) return "";

  return addDays(sameDayNextTerm, -1) ?? "";
}

/** The period that follows one ending on `currentEnd`. */
export function nextPeriod(
  currentEnd: string,
  term: BillingTerm | null,
): { start: string; end: string } {
  const start = addDays(currentEnd, 1);
  if (!start) return { start: "", end: "" };

  return { start, end: periodEnd(start, term) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/renewals/next-period.test.ts`
Expected: PASS, 12 tests.

If the leap-year case fails, check `daysInMonth`: `Date.UTC(year, month, 0)` uses
a 0-indexed month plus one, which lands on the last day of `month` as passed
1-indexed. That is intentional — do not "fix" it to `month - 1`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renewals/next-period.ts src/lib/renewals/next-period.test.ts
git commit -m "$(cat <<'EOF'
Add the next-period dates for a renewal

A period ends the day before the next one starts, so a yearly term from
1 Nov 2026 ends 31 Oct 2027. A day out in one direction double-bills a day;
in the other it leaves a gap, and the gap is what makes a paid-up customer
show as overdue.

Month arithmetic clamps instead of overflowing, so 31 January plus three
months is 30 April rather than 1 May as setMonth would give.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: List + create API

**Files:**
- Create: `src/app/api/admin/renewals/route.ts`

**Interfaces:**
- Consumes: `requireFounder`, `serviceClient`, `toErrorResponse`; `todayInIndia`; `inBucket`, `bucketSummary` from `@/lib/renewals/buckets`; `periodEnd` from `@/lib/renewals/next-period`; `asTerm` from `@/lib/plans/pricing`.
- Produces: `GET /api/admin/renewals?bucket=` → `{ subscriptions, summary, today }`; `POST` → `{ id }`. Exports `WRITABLE_FIELDS` and `cleanBody()` for the `[id]` route.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/renewals/route.ts`:

```ts
// ============================================================
// The renewal register: list + create. Founder-only.
//
// requireFounder() on the caller's own session, then the service-role client —
// platform_subscriptions has RLS with no policies.
//
// The response carries `today` (the IST date the server used) and the bucket
// summary computed with it, so the browser never decides what "today" means. A
// founder opening this at 23:50 IST and a cron reading it at 00:10 UTC must see
// the same answer.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { bucketSummary, inBucket } from "@/lib/renewals/buckets";
import { periodEnd } from "@/lib/renewals/next-period";
import { BUCKETS, RENEWAL_STATUSES, type RenewalBucket, type SubscriptionRow } from "@/lib/renewals/types";

const COLUMNS =
  "id, customer_id, company_name, plan, billing_term, users, amount, start_date, " +
  "end_date, salesman_name, contact_person, phone, status, remarks, follow_up_date, " +
  "created_at, updated_at";

/** Only these may be written. Anything else in the body is ignored, not trusted. */
export const WRITABLE_FIELDS = [
  "customer_id", "company_name", "plan", "billing_term", "users", "amount",
  "start_date", "end_date", "salesman_name", "contact_person", "phone",
  "status", "remarks", "follow_up_date",
] as const;

const TEXT_FIELDS = new Set<string>([
  "customer_id", "company_name", "plan", "salesman_name", "contact_person",
  "phone", "remarks",
]);

/**
 * The body, narrowed to writable columns with the right types.
 *
 * Exported because the create and update routes must clean identically: a
 * second copy of this would be how `follow_up_date` ends up stored as "" on one
 * path and null on the other, and an empty string is not a valid `date`.
 */
export function cleanBody(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const key of WRITABLE_FIELDS) {
    if (body?.[key] === undefined) continue;
    const value = body[key];

    if (TEXT_FIELDS.has(key)) {
      patch[key] = typeof value === "string" ? value.trim() : "";
      continue;
    }

    if (key === "users") {
      patch[key] = Math.max(0, Math.floor(Number(value) || 0));
      continue;
    }

    if (key === "amount") {
      patch[key] = Math.max(0, Math.round(Number(value) || 0));
      continue;
    }

    if (key === "billing_term") {
      patch[key] = value ? asTerm(value) : null;
      continue;
    }

    if (key === "status") {
      patch[key] = (RENEWAL_STATUSES as readonly string[]).includes(String(value))
        ? value
        : "active";
      continue;
    }

    // The three date columns. An empty string is not a valid `date`, so a blank
    // follow-up date must be stored as NULL.
    patch[key] = typeof value === "string" && value.length === 10 ? value : null;
  }

  return patch;
}

function isBucket(value: unknown): value is RenewalBucket {
  return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_subscriptions")
      .select(COLUMNS)
      .order("end_date", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as SubscriptionRow[];
    const today = todayInIndia();

    const requested = req.nextUrl.searchParams.get("bucket");
    const bucket: RenewalBucket = isBucket(requested) ? requested : "all";

    return NextResponse.json({
      today,
      bucket,
      // Summary is always over EVERY row, so the tiles keep their meaning while
      // a tab narrows the table beneath them.
      summary: bucketSummary(rows, today),
      subscriptions: rows.filter((row) => inBucket(row, bucket, today)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = await req.json().catch(() => ({}));
    const patch = cleanBody(body);

    if (!patch.company_name) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!patch.start_date) {
      return NextResponse.json({ error: "Start date is required" }, { status: 400 });
    }

    // A missing end date is filled from the term rather than refused: the form
    // computes it, and a direct POST without one still has one right answer.
    if (!patch.end_date) {
      patch.end_date = periodEnd(
        String(patch.start_date),
        (patch.billing_term as never) ?? null,
      );
    }

    if (!patch.end_date) {
      return NextResponse.json({ error: "End date is required" }, { status: 400 });
    }
    if (String(patch.end_date) < String(patch.start_date)) {
      return NextResponse.json(
        { error: "The subscription cannot end before it starts." },
        { status: 400 },
      );
    }

    const { data, error } = await serviceClient()
      .from("platform_subscriptions")
      .insert({ ...patch, created_by: ctx.userId })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: data.id });
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
git add src/app/api/admin/renewals/route.ts
git commit -m "$(cat <<'EOF'
Add the renewal list and create API, founder-only

The response carries the IST date the server used and the bucket summary
computed with it, so the browser never decides what "today" means. The
summary is always over every row, so the tiles keep their meaning while a
tab narrows the table under them.

cleanBody() is shared with the update route on purpose: a second copy is how
a blank follow-up date ends up stored as "" on one path and null on the
other, and an empty string is not a valid date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: One-subscription API and the renew RPC

**Files:**
- Create: `src/app/api/admin/renewals/[id]/route.ts`
- Create: `src/app/api/admin/renewals/[id]/renew/route.ts`

**Interfaces:**
- Consumes: `cleanBody` from `../route`; `periodEnd` from `@/lib/renewals/next-period`; `asTerm` from `@/lib/plans/pricing`.
- Produces: `GET` (row + history), `PATCH`, `DELETE` at `/api/admin/renewals/[id]`; `POST /api/admin/renewals/[id]/renew`.

- [ ] **Step 1: Write the row route**

Create `src/app/api/admin/renewals/[id]/route.ts`:

```ts
// ============================================================
// Read / update / delete one subscription. Founder-only, service-role.
//
// The read also returns the history, because the detail panel never wants one
// without the other.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { cleanBody } from "../route";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const admin = serviceClient();

    const { data: subscription, error } = await admin
      .from("platform_subscriptions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const { data: periods } = await admin
      .from("platform_subscription_periods")
      .select("*")
      .eq("subscription_id", id)
      .order("start_date", { ascending: false });

    return NextResponse.json({ subscription, periods: periods ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;
    const body = await req.json().catch(() => ({}));
    const patch = cleanBody(body);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = serviceClient();

    // The dates may arrive one at a time, so the ordering check has to compare
    // the patch against what the row already holds — not only against itself.
    const { data: current } = await admin
      .from("platform_subscriptions")
      .select("start_date, end_date")
      .eq("id", id)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const start = String(patch.start_date ?? current.start_date);
    const end = String(patch.end_date ?? current.end_date);
    if (end < start) {
      return NextResponse.json(
        { error: "The subscription cannot end before it starts." },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("platform_subscriptions")
      .update(patch)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
    const { id } = await props.params;

    // The history rows go with it: the FK is ON DELETE CASCADE.
    const { error } = await serviceClient()
      .from("platform_subscriptions")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Write the renew route**

Create `src/app/api/admin/renewals/[id]/renew/route.ts`:

```ts
// ============================================================
// Renew one subscription: archive the current period, advance the row.
//
// A thin wrapper over renew_platform_subscription(), because the atomicity is
// the whole point — doing the two writes from here would leave a renewal
// half-done if the second failed, or write history twice on a retry.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm } from "@/lib/plans/pricing";
import { periodEnd } from "@/lib/renewals/next-period";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireFounder();
    const { id } = await props.params;
    const body = await req.json().catch(() => ({}));
    const admin = serviceClient();

    const { data: current } = await admin
      .from("platform_subscriptions")
      .select("plan, billing_term, users, amount, end_date")
      .eq("id", id)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const term = asTerm(body?.billing_term ?? current.billing_term);

    const start =
      typeof body?.start_date === "string" && body.start_date.length === 10
        ? body.start_date
        : null;

    if (!start) {
      return NextResponse.json({ error: "A new start date is required" }, { status: 400 });
    }

    const end =
      typeof body?.end_date === "string" && body.end_date.length === 10
        ? body.end_date
        : periodEnd(start, term);

    if (!end) {
      return NextResponse.json({ error: "A new end date is required" }, { status: 400 });
    }
    if (end < start) {
      return NextResponse.json(
        { error: "The new period cannot end before it starts." },
        { status: 400 },
      );
    }

    const { data, error } = await admin.rpc("renew_platform_subscription", {
      p_id: id,
      // Omitted fields keep what the row already had: the SQL coalesces, so a
      // renewal that only moves the dates does not blank the plan or amount.
      p_plan: typeof body?.plan === "string" ? body.plan.trim() : null,
      p_billing_term: term,
      p_users:
        body?.users === undefined ? null : Math.max(0, Math.floor(Number(body.users) || 0)),
      p_amount:
        body?.amount === undefined ? null : Math.max(0, Math.round(Number(body.amount) || 0)),
      p_start_date: start,
      p_end_date: end,
      p_renewed_by: ctx.userId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ subscription: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors in either new file.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/renewals/[id]"
git commit -m "$(cat <<'EOF'
Add the one-subscription API and the renew endpoint

Renewing is a thin wrapper over renew_platform_subscription(), because the
atomicity is the point: archiving and advancing as two writes from here
would leave a renewal half-done if the second failed, or write the history
twice on a retry.

The update route compares a date against what the row already holds rather
than only against the patch, since the two dates can arrive one at a time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The daily renewal screen

**Files:**
- Create: `src/app/(superadmin)/admin/renewals/page.tsx`
- Create: `src/app/(superadmin)/admin/renewals/renewals-client.tsx`
- Modify: `src/app/(superadmin)/admin/admin-shell.tsx` — add the nav entry

**Interfaces:**
- Consumes: `GET /api/admin/renewals?bucket=`; `DataTable` + `ColumnDef` from `@/components/ui/data-table/*`; `useTableView` from `@/hooks/use-table-view`; `matchesColumnFilters` from `@/lib/table/match-filters`; `formatCurrency` from `@/lib/currency`; `daysUntil` from `@/lib/renewals/buckets`.
- Produces: the screen at `/admin/renewals`.

- [ ] **Step 1: Write the server guard**

Create `src/app/(superadmin)/admin/renewals/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import RenewalsClient from "./renewals-client";

// The founder's renewal register — founder-only.
//
// Triple-gated like the proposals list: the (superadmin) layout blocks
// non-superadmins, requireFounder() 404s any other superadmin, and
// platform_subscriptions has RLS with no policies.
export const dynamic = "force-dynamic";

export default async function RenewalsPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <RenewalsClient />;
}
```

- [ ] **Step 2: Write the client**

Create `src/app/(superadmin)/admin/renewals/renewals-client.tsx`.

State and loading:

```tsx
const [bucket, setBucket] = useState<RenewalBucket>("today");
const [rows, setRows] = useState<SubscriptionRow[]>([]);
const [summary, setSummary] = useState<Record<RenewalBucket, BucketFigure> | null>(null);
const [today, setToday] = useState<string>("");
const [loading, setLoading] = useState(true);
```

`load()` fetches `/api/admin/renewals?bucket=${bucket}` and sets all four. It
re-runs when `bucket` changes and after any successful add, edit, renew or
delete. **`today` always comes from the response** — never from
`new Date()` in the browser, which is the whole point of the server returning it.

The screen, top to bottom:

1. **A heading row**: "Renewals", the resolved date in words
   (`Due today — 20 Oct 2026`), and a `+ Add Subscription` button.
2. **Four tiles** from `summary`, in this order: Due Today, Overdue, Next 7
   Days, Next 30 Days. Each shows the count large and
   `formatCurrency(figure.amount)` beneath. Colour: today amber, overdue red,
   the other two muted. Clicking a tile sets `bucket` to it — the tiles are the
   fastest way to the tab.
3. **Tabs** over `BUCKETS` using `BUCKET_LABEL`, with the active one underlined.
   Default `"today"`, because that is the job this screen exists for.
4. **The table**, `useTableView("platform_subscriptions", {})` plus
   `matchesColumnFilters`, with these columns:

```tsx
const columns: ColumnDef<SubscriptionRow>[] = [
  { id: "customer_id", label: "Customer ID", type: "text", sortable: true },
  { id: "company_name", label: "Company", type: "text", sortable: true,
    render: (r) => <span className="font-medium">{r.company_name}</span> },
  { id: "plan", label: "Plan", type: "text", sortable: true },
  { id: "billing_term", label: "Term", type: "select",
    options: BILLING_TERMS.map((t) => ({ label: TERM_LABEL[t], value: t })),
    render: (r) => (r.billing_term ? TERM_LABEL[r.billing_term] : "—") },
  { id: "users", label: "Users", type: "range", sortable: true },
  { id: "amount", label: "Amount", type: "range", sortable: true,
    render: (r) => formatCurrency(r.amount) },
  { id: "start_date", label: "Start", type: "date", sortable: true,
    render: (r) => formatDate(r.start_date) },
  { id: "end_date", label: "End", type: "date", sortable: true,
    render: (r) => formatDate(r.end_date) },
  { id: "days_left", label: "Days Left", type: "range", sortable: true,
    filterValue: (r) => daysUntil(r.end_date, today) ?? 0,
    render: (r) => <DaysLeftBadge days={daysUntil(r.end_date, today)} /> },
  { id: "salesman_name", label: "Salesman", type: "text", sortable: true },
  { id: "contact_person", label: "Contact Person", type: "text" },
  { id: "phone", label: "Phone", type: "text",
    render: (r) => r.phone
      ? <a href={`tel:${r.phone}`} className="hover:underline">{r.phone}</a>
      : "—" },
  { id: "status", label: "Status", type: "select",
    options: RENEWAL_STATUSES.map((s) => ({ label: RENEWAL_STATUS_LABEL[s], value: s })),
    render: (r) => <StatusBadge status={r.status} /> },
  { id: "follow_up_date", label: "Follow Up", type: "date", sortable: true,
    render: (r) => (r.follow_up_date ? formatDate(r.follow_up_date) : "—") },
  { id: "remarks", label: "Remarks", type: "text",
    render: (r) => <span className="line-clamp-2">{r.remarks || "—"}</span> },
];
```

   Every one of those has a filter type, so the filter row has no dead cells and
   Manage Columns covers the whole row — the house rule for this repo's tables.

5. **`DaysLeftBadge`**: a `rounded-full px-2 py-1 text-xs font-medium` span.
   `days === null` → "—"; `days < 0` → red, `{Math.abs(days)}d overdue`;
   `days === 0` → amber, "Today"; `days <= 7` → amber, `{days}d`; else muted,
   `{days}d`. Use the `bg-*-500/10 text-*-600 dark:text-*-400` form, never
   `hsl(var(--x))` inline.
6. **Row actions** via the repo's `row-actions.tsx` pattern: **Renew** (opens
   `<RenewDialog>`), **Edit** (opens `<SubscriptionForm>` with the row),
   **WhatsApp** (`https://wa.me/<digits>` — digits from the phone, prefixed
   `91` when it is ten), **Call** (`tel:`), **Delete** (a confirm naming the
   company and saying the history goes with it).
7. **Empty states**: on the Today tab with no rows, "Nobody is due today." —
   not a generic "no data" message. When the fetch fails with a missing-relation
   error, "The renewals migration has not been applied to the database yet."

- [ ] **Step 3: Add the nav entry**

In `src/app/(superadmin)/admin/admin-shell.tsx`, import `CalendarClock` from
`lucide-react` and add to `FOUNDER_NAV_ITEMS`, next to the Invoices entry:

```tsx
  { href: "/admin/renewals", label: "Renewals", icon: CalendarClock },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean, with `/admin/renewals` in the route list.

Open `/admin/renewals` as the founder and check: it lands on Due Today, the four
tiles read zero on an empty register, every column has a working filter, and the
nav link appears.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(superadmin)/admin/renewals/page.tsx" "src/app/(superadmin)/admin/renewals/renewals-client.tsx" "src/app/(superadmin)/admin/admin-shell.tsx"
git commit -m "$(cat <<'EOF'
Add the daily renewal screen

It opens on Due Today, because that is the job it exists for, with tiles for
today, overdue and the next week and month that double as tab shortcuts. The
date the days-left badge counts from is the IST date the server returned, not
the browser's clock.

Every column carries a filter type, so the filter row has no dead cells and
Manage Columns covers the whole row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add / edit, and the Renew dialog

**Files:**
- Create: `src/app/(superadmin)/admin/renewals/subscription-form.tsx`
- Create: `src/app/(superadmin)/admin/renewals/renew-dialog.tsx`

**Interfaces:**
- Consumes: `POST`/`PATCH /api/admin/renewals*`, `POST /api/admin/renewals/[id]/renew`, `GET /api/admin/renewals/[id]`; `periodEnd`, `nextPeriod` from `@/lib/renewals/next-period`.
- Produces: `<SubscriptionForm open subscription?={row} onSaved />`; `<RenewDialog open subscription={row} onRenewed />`.

- [ ] **Step 1: Write the add / edit form**

Create `src/app/(superadmin)/admin/renewals/subscription-form.tsx` — a `Dialog`
from `@/components/ui/dialog` wrapping a form over every writable field, in this
order: Company Name (required), Customer ID, Plan, Billing Term, Users, Amount,
Start Date (required), End Date, Salesman Name, Contact Person, Phone, Status,
Follow-Up Date, Remarks.

Three behaviours that matter:

1. **The end date auto-fills but stays editable.** When the start date or the
   term changes and the end date has not been hand-edited, set it with
   `periodEnd(startDate, term)`. Track a `endTouched` boolean so that once the
   founder types an end date, a later term change does not overwrite it.
2. **Plan is a `<select>` over `PLAN_IDS` with `PLAN_LABEL`, plus a free-text
   option.** The column is free text by design — a legacy or custom package has
   to be recordable — so offer the catalogue values for speed and allow anything.
3. **Save** posts to `/api/admin/renewals` (create) or
   `PATCH /api/admin/renewals/<id>` (edit), then `toast.success` and
   `onSaved()`. On failure, `toast.error(payload.error)` and leave the dialog
   open with the values intact — never clear a form the founder has just filled.

- [ ] **Step 2: Write the Renew dialog**

Create `src/app/(superadmin)/admin/renewals/renew-dialog.tsx`.

On open, it computes the proposed next period and loads the history:

```tsx
const proposed = nextPeriod(subscription.end_date, subscription.billing_term);

const [form, setForm] = useState({
  plan: subscription.plan,
  billing_term: subscription.billing_term ?? "yearly",
  users: subscription.users,
  amount: subscription.amount,
  start_date: proposed.start,
  end_date: proposed.end,
});
```

It must show, in this order:

1. **A one-line summary of what is ending**: `Current period: <start> to <end>`.
2. **The new period**, as editable fields: term, start date, end date, users,
   amount. Changing the term or the start date recomputes the end date with
   `periodEnd`, with the same `endTouched` guard as the form.
3. **A plain sentence**: "The period ending <end> will be saved to this
   customer's history." — so the founder knows nothing is lost.
4. **The history**, fetched from `GET /api/admin/renewals/<id>`: a small list of
   past periods, each `<start> – <end> · <plan> · <users> users · <amount>`,
   newest first, with "No earlier periods." when empty.
5. **Confirm** posts to `/api/admin/renewals/<id>/renew`, toasts, and calls
   `onRenewed()` so the list reloads. Disable the button while in flight — a
   double click would archive the same period twice if the lock did not stop it,
   and the lock should not be the only thing that does.

- [ ] **Step 3: Verify the whole flow in the preview**

Run: `npm run typecheck && npm run build`

Then, as the founder on `/admin/renewals`:
- add a subscription with a yearly term starting 01 Nov 2026 → the end date
  fills as 31 Oct 2027;
- set its end date to today → it appears on the Due Today tab and the tile reads
  1 with its amount;
- renew it → the dialog proposes tomorrow as the start and one year on minus a
  day as the end; confirm it, and the row moves off Due Today while the old
  period appears under history;
- set a row's status to Lost → it leaves the due tabs and tiles but stays under
  All;
- edit a row, make the end date earlier than the start → the API refuses with a
  readable message and the dialog stays open.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(superadmin)/admin/renewals/subscription-form.tsx" "src/app/(superadmin)/admin/renewals/renew-dialog.tsx"
git commit -m "$(cat <<'EOF'
Add the renewal add/edit form and the Renew dialog

The end date auto-fills from the term and the start date, but stops doing so
once it has been typed: a later term change must not overwrite a date the
founder set deliberately.

Renew proposes the next period — the day after the current one ends, running
one whole term — shows the history it is about to add to, and says in a
sentence that the ending period is being kept. The confirm button disables
while in flight, so a double click cannot try to archive the same period
twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Ship it

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

Add a section covering: the two tables and their founder-only RLS posture; that
the register is maintained **by hand** and derives nothing from `accounts`; that
it has **no relationship to the invoice module** and that this is deliberate;
that all day arithmetic lives in `src/lib/renewals/buckets.ts` and is computed
in IST on the server, with the resolved date returned to the browser; and that
`renew_platform_subscription()` is the only writer of
`platform_subscription_periods`.

- [ ] **Step 3: Commit and push**

```bash
git add PROJECT.md
git commit -m "$(cat <<'EOF'
Document the renewal module in PROJECT.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 4: Tell the founder what he has to do**

In plain words:
1. Run `supabase/migrations/20261020130000_platform_subscriptions.sql` by hand on
   the Mumbai project. The screen does not work before that.
2. Add his live customers to `/admin/renewals` — company, Customer ID, plan,
   term, users, amount, start and end dates, salesman and contact. Nothing is
   imported for him, by design.

Give him the commit hashes.

---

# Self-Review

**Spec coverage.** Part 2 of the spec maps task for task: both tables, the RPC
and the RLS posture → Task 1; `buckets.ts` with IST day arithmetic and the
`lost`-excluded due tabs → Task 2; the next-period dates the Renew dialog
proposes → Task 3; the list API with server-resolved `today` → Task 4; the row
API, history read and the renew endpoint → Task 5; the Due-Today-first screen,
tiles, tabs, the full filterable table and the nav entry → Task 6; add/edit and
the Renew dialog with history → Task 7; docs, the real test run and the
migration hand-over → Tasks 1 and 8.

**Three fields the spec listed that are deliberately placed, not dropped.**
`customer_id` is `text` and not a foreign key (Task 1), `plan` is `text` with a
picker rather than an enum (Tasks 1 and 7), and `salesman_name` is free text —
all three because the register has to hold customers and packages the
entitlement system does not know about.

**One deviation from the spec, and why.** The spec said
`lib/renewals/buckets.ts` would define its own `todayInIST()`. `todayInIndia()`
already exists in `src/lib/proposals/today.ts` with exactly that
`Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })` implementation and
its own tests, so it is reused. A second copy of the one function that decides
what "today" means is precisely the duplication that produces two different
answers.

**Type consistency.** `SubscriptionRow`, `PeriodRow`, `RenewalStatus`,
`RenewalBucket`, `BUCKETS`, `BUCKET_LABEL`, `RENEWAL_STATUSES` and
`RENEWAL_STATUS_LABEL` are defined once in Task 2 and imported by name
afterwards. `BucketFigure` comes from `buckets.ts` (Task 2) and is used in Tasks
4 and 6. `daysUntil(endDate, today?, now?)`, `inBucket(row, bucket, today?, now?)`
and `bucketSummary(rows, today?, now?)` keep those argument orders everywhere
they are called. `periodEnd(start, term)` and `nextPeriod(currentEnd, term)` are
defined in Task 3 and called in Tasks 4, 5 and 7 with those signatures.
`cleanBody()` is exported from the list route in Task 4 and imported by the row
route in Task 5. The RPC's eight `p_*` parameter names in Task 5 match the SQL
signature in Task 1 exactly.

**No invoice coupling anywhere.** No task imports from `src/lib/invoices/`,
reads `platform_invoices`, or creates an invoice on renewal. The constraint is
stated at the top of this plan so a worker reading only one task still sees it.

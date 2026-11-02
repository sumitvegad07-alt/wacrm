# Target & Incentive — internal plan

**Status:** PLAN ONLY. Nothing built.
**Scope decision (founder, 2026-11-02):** this goes into **the product, for every tenant** —
unlike the DMS and the extra order statuses, which are one tenant's customisation. It is
plan-gated like every other module and ships off by default.
**Why it is worth building:** every FMCG and SFA prospect asks for it, and we currently
answer "no". It is the single largest hole in the SFA line.

---

## 1. How FMCG actually runs targets — the research

The founder asked for deep research before design. This section is the part of it that
changes the design.

**Caveat on the numbers below:** the Indian FMCG material available publicly is almost all
vendor marketing (Bizom, FieldAssist, BeatRoute, and a tier of smaller blogs). The figures
disagree with each other and none is an independent benchmark. They are used here to decide
*what the module must be able to express*, never as defaults we ship. Sources are listed in
section 9.

### 1.1 Primary, secondary, tertiary — and why it decides the data model

- **Primary sales** = company bills the distributor.
- **Secondary sales** = distributor moves goods to the retailer.
- **Tertiary sales** = retailer sells to the consumer.

A target set on primary alone is gameable, and everybody in the industry knows it: a brand
can hit its primary number while secondary stagnates, which just builds distributor stock.
The usual health check is the **sell-out to sell-in ratio** — sources quote a healthy band
of roughly 0.85–0.95, with below 0.7 read as channel stuffing.

**What this means for us:** OZZO's `orders` are secondary sales (salesman books an order at
a retailer). Primary sales only exist once the DMS tracks distributor purchases. So:

> **Targets v1 measures secondary sales, and says so plainly in the UI.** Primary-vs-secondary
> target comparison is a v2 that depends on the DMS. Do not pretend otherwise — mislabelling
> which sale a target measures is the fastest way to lose an FMCG customer's trust.

### 1.2 Targets are never only money

This is the finding that most changes the build. Across every source the measures a real
FMCG company sets targets on are:

| Measure | Why they track it |
|---------|-------------------|
| **Value** (₹) | The headline number |
| **Volume** (units / cases) | Protects against hitting value by selling only premium SKUs |
| **Outlet coverage** | Share of the beat's outlets actually visited |
| **Productive calls** | Share of visits that produced an order — the leading indicator |
| **Lines per call** | Breadth of the order; stops one-SKU selling |
| **New outlets added** | Distribution expansion |
| **Collections** (₹ received) | Because an order is not a sale until it is paid |
| **Focus SKU / category volume** | Pushing a new launch |

Coverage benchmarks cited run 90–95% in metro and 65–75% rural; productive-call benchmarks
75–85%; beat adherence 80–90%. We ship **none** of these as defaults — the spread between
sources is too wide to be credible, and a wrong default is worse than a blank field. But the
module must be able to *express* every one of them, because a prospect will ask for at least
three of them in the first demo.

**OZZO already has all the raw data** for every measure above. That is the point: targets
is mostly a measurement and presentation layer over data we already collect, not a new
collection problem.

### 1.3 How incentives are actually calculated

Achievement is always `achieved / target × 100`. What differs is how a payout is derived
from it:

1. **Flat rate** — a percentage of achieved value. Simple, rare on its own.
2. **Slabs, flat within slab** — reach 90% and the *whole month's* sales pay at the 90%
   rate. This is the common Indian structure and the one to build first.
3. **Slabs, marginal** — each bracket pays only on the sales inside it, like income tax.
4. **Threshold / cliff** — nothing at all below a floor, commonly 70% of target. Appears in
   most real schemes.
5. **Accelerator** — a multiplier (1.25×–1.5×) or a flat kicker (₹5,000) above 100%.
6. **Weighted multi-KPI** — e.g. 60% value + 20% coverage + 20% new outlets, each scored
   against its own target, combined into one achievement figure.

Variable pay in Indian retail/FMCG is quoted at roughly **10–20% of total pay, settled
monthly**.

One warning worth taking seriously: salesman attrition in Indian FMCG distribution is
reported at **30–50% a year**, and opaque, delayed and disputed incentive calculation is
named as a contributing cause. The suggested antidote is a formula simple enough that the
salesman can compute it himself.

**What this means for us:** the payout statement is not a nice-to-have; it is the feature.
A number with no visible arithmetic behind it will be disputed, and a disputed incentive is
worse than no incentive. **Every payout must show its own working** — target, achieved,
achievement %, which slab, which rate, and the resulting amount, on one screen the salesman
can open on his phone.

### 1.4 Design consequences, in one list

1. Measures are **plural and configurable**, not "value only".
2. A target has **one measure**; a *scheme* combines several with weights. Keeping those
   separate is what makes the model stay comprehensible.
3. **Slab-flat is the default engine.** Marginal, threshold and accelerator are options on
   the same engine, not separate engines.
4. **Show the arithmetic.** Always.
5. **Freeze a period.** Once a month is approved, its numbers never move again, even if an
   order is edited afterwards. Without this, payouts silently change after payment and the
   module becomes a liability.
6. Say which sale is being measured (secondary, for v1).

---

## 2. Data model

```sql
-- ── What can be measured ────────────────────────────────────────────────
-- Seeded per account, as a table rather than an enum so a tenant can switch
-- measures off and so a new one does not need a migration.
create table public.target_measures (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  key         text not null,   -- order_value | order_qty | collections |
                               -- visits | productive_visits | new_outlets |
                               -- outlet_coverage | lines_per_call
  label       text not null,
  unit        text not null,   -- currency | count | percent
  is_active   boolean not null default true,
  unique (account_id, key)
);

-- ── A target ───────────────────────────────────────────────────────────
-- Exactly one measure, one owner, one period. Everything else composes.
create table public.targets (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  measure_key  text not null,
  -- Who it is for. Exactly one of these is set; a CHECK enforces it.
  employee_id    uuid null references profiles(id)      on delete cascade,
  territory_id   uuid null references territories(id)   on delete cascade,
  route_id       uuid null references routes(id)        on delete cascade,
  distributor_id uuid null,  -- FK added with the DMS
  -- Over what
  period_type  text not null,              -- month | quarter | year | custom
  period_start date not null,
  period_end   date not null,
  target_value numeric(14,2) not null check (target_value > 0),
  -- Optional narrowing: this target counts only these products/categories
  product_id   uuid null references products(id)           on delete cascade,
  category_id  uuid null references product_categories(id) on delete cascade,
  notes        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint targets_one_owner check (
    (employee_id is not null)::int + (territory_id is not null)::int +
    (route_id    is not null)::int + (distributor_id is not null)::int = 1
  )
);

create index targets_lookup_idx
  on public.targets (account_id, measure_key, period_start, period_end);

-- ── Achievement, frozen per period ─────────────────────────────────────
-- Recomputed on demand while the period is open; written once and never
-- recomputed after approval. This is what stops a paid incentive from
-- quietly changing because somebody edited last month's order.
create table public.target_achievements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  target_id     uuid not null references targets(id) on delete cascade,
  achieved_value numeric(14,2) not null default 0,
  achievement_pct numeric(6,2) not null default 0,
  computed_at   timestamptz not null default now(),
  frozen_at     timestamptz null,
  unique (target_id)
);

-- ── Incentive schemes ──────────────────────────────────────────────────
create table public.incentive_schemes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  payout_mode text not null default 'slab_flat',
    -- flat | slab_flat | slab_marginal
  threshold_pct numeric(5,2) null,   -- nothing paid below this achievement
  accelerator_pct numeric(5,2) null, -- extra rate above 100%
  accelerator_flat numeric(12,2) null,
  cap_amount  numeric(12,2) null,
  period_type text not null default 'month',
  requires_approval boolean not null default true,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Which measures the scheme scores, and how much each one is worth.
-- Weights must sum to 100 — enforced in the RPC, not by a constraint,
-- so the editor can save a draft that does not yet add up.
create table public.incentive_scheme_measures (
  scheme_id   uuid not null references incentive_schemes(id) on delete cascade,
  measure_key text not null,
  weight_pct  numeric(5,2) not null,
  primary key (scheme_id, measure_key)
);

create table public.incentive_slabs (
  id          uuid primary key default gen_random_uuid(),
  scheme_id   uuid not null references incentive_schemes(id) on delete cascade,
  from_pct    numeric(5,2) not null,
  to_pct      numeric(5,2) null,            -- null = open-ended top slab
  rate_pct    numeric(6,3) null,            -- % of achieved value
  flat_amount numeric(12,2) null,           -- or a fixed sum
  check (rate_pct is not null or flat_amount is not null)
);

create table public.incentive_assignments (
  scheme_id   uuid not null references incentive_schemes(id) on delete cascade,
  employee_id uuid null references profiles(id) on delete cascade,
  role_id     uuid null references employee_roles(id) on delete cascade,
  primary key (scheme_id, employee_id, role_id)
);

-- ── Payouts ────────────────────────────────────────────────────────────
create table public.incentive_payouts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  scheme_id     uuid not null references incentive_schemes(id),
  employee_id   uuid not null references profiles(id),
  period_start  date not null,
  period_end    date not null,
  achievement_pct numeric(6,2) not null,
  gross_amount  numeric(12,2) not null,
  adjustment    numeric(12,2) not null default 0,
  adjustment_note text,
  net_amount    numeric(12,2) not null,
  -- The arithmetic, kept so the statement can always be re-shown exactly as
  -- it was approved — see 1.3. Never recomputed after approval.
  breakdown     jsonb not null default '{}'::jsonb,
  status        text not null default 'draft',  -- draft|submitted|approved|rejected|paid
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (scheme_id, employee_id, period_start)
);
```

### 2.1 Where achievement comes from

One RPC per measure, all account- and period-scoped, all respecting the reporting hierarchy
(founder rule: *every dashboard must scope by reporting hierarchy AND plan*).

| Measure | Source |
|---------|--------|
| `order_value` | `orders` where status `counts_as_sale`, dated in the period, account timezone |
| `order_qty` | `order_items.base_quantity` (base unit, so Multi Unit does not distort it) |
| `collections` | `payments` received in the period |
| `visits` | `site_visits` |
| `productive_visits` | `site_visits` that produced an order — the existing Visit report definition |
| `new_outlets` | `contacts` created in the period |
| `outlet_coverage` | distinct dealers visited ÷ dealers on the beat |
| `lines_per_call` | order lines ÷ visits |

**Two traps already learned in this codebase and repeated here so they are not re-learned:**

1. **Dates are account-local.** Every period boundary is `AT TIME ZONE` the account's
   timezone, never `toISOString()`. A month target that silently includes 1 June 00:00 IST
   as May is wrong by a day's sales.
2. **Aggregate in SQL, never in JS.** An unbounded PostgREST `.select()` returns 1,000 rows
   with no error, which is how every dashboard money total in this app was once wrong. Each
   measure is one RPC returning one number.

### 2.2 The payout engine

Pure TypeScript in `src/lib/incentives/engine.ts`, no database access, fully unit-tested
against worked examples — the same shape as `src/lib/route/repeat-schedule.ts`. This is the
most important testable surface in the module: it decides what people get paid.

```
computePayout(scheme, measures[]) ->
  1. per measure: achievementPct = achieved / target * 100
  2. combined   = Σ (achievementPct_i × weight_i) / 100
  3. if threshold set and combined < threshold -> 0, reason 'below_threshold'
  4. pick the slab containing `combined`
  5. slab_flat     -> amount = achievedValue × slab.rate   (or slab.flat)
     slab_marginal -> sum over slabs of (value in slab × slab.rate)
     flat           -> achievedValue × scheme.rate
  6. if combined > 100 and accelerator set -> add the accelerator
  7. if cap set -> min(amount, cap)
  8. return { amount, breakdown }  // breakdown holds every step above
```

`breakdown` is stored and rendered verbatim on the statement. That is the answer to the
attrition/dispute finding in 1.3.

---

## 3. Screens

### Web — admin

| Screen | Purpose |
|--------|---------|
| **Targets** (list) | All targets, filtered by measure, owner, period. Server-paged like every other list |
| **Set Targets** (grid) | The screen that decides adoption: employees down the rows, periods across the columns, type straight in. Copy last period, spread an annual figure across months, bulk-apply a growth % |
| **Import Targets** | A descriptor in the existing Universal Import Framework. Nobody types 200 targets by hand |
| **Achievement** | Target vs achieved vs % per employee, with a drill-through to the orders behind the number |
| **Incentive Schemes** | Scheme editor: measures + weights, slabs, threshold, accelerator, cap, who it applies to |
| **Payouts** | Per period: compute, review, adjust with a note, approve, mark paid. Print and export |

### Web — employee / manager
A **My Targets** panel on the dashboard: achievement gauge, the gap to the next slab, and
the indicative incentive at today's achievement.

### Mobile
| Screen | Purpose |
|--------|---------|
| **My Target** | This month's target, achieved, % and days remaining |
| **How I get paid** | The slab table with "you are here", and the next slab's value |
| **My Incentive** | Current period estimate, and past approved payouts with the full breakdown |

The mobile side is deliberately read-only. A salesman needs to know the number and trust
it; he never needs to edit it.

---

## 4. Rights and gating

**Permissions:** `view_targets`, `manage_targets`, `view_team_targets`, `view_own_target`,
`view_incentive_schemes`, `manage_incentive_schemes`, `view_own_incentive`,
`view_team_incentive`, `approve_incentive_payout`, `mark_incentive_paid`.

`view_own_target` and `view_own_incentive` go to every field role by default — they are the
point of the module. Everything else is admin/manager.

**Plan gating:** a `targets` surface gate in `lib/plans/surface-gates.ts` (the single table
added after the gating leak audit — do not add a second place). Proposal: SFA and CRM+SFA
get it; CRM-only and WFA-only do not. **Founder to confirm**, since this is a pricing
decision, not an engineering one.

**Module toggle:** `accounts.module_settings.targets`, default **false**. Existing tenants
see no new menu item until they switch it on.

---

## 5. Work breakdown — 29 days (~6 weeks)

| # | Task | Days |
|---|------|------|
| 1 | Spec review with the founder + sign-off on measures, modes and gating | 2 |
| 2 | Migration: 9 tables, RLS, seeds, indexes | 2 |
| 3 | Achievement RPCs — 8 measures, account-local dates, hierarchy-scoped | 4 |
| 4 | Payout engine + unit tests (worked examples for all 6 modes) | 3 |
| 5 | Targets list + Set Targets grid | 4 |
| 6 | Target import descriptor | 1 |
| 7 | Achievement screen with drill-through | 2 |
| 8 | Scheme editor (measures, weights, slabs, threshold, accelerator, cap) | 3 |
| 9 | Payout run, adjust, approve, mark paid, print | 3 |
| 10 | Mobile: My Target / How I get paid / My Incentive | 3 |
| 11 | Dashboard panel + Target vs Achievement report in the report engine | 2 |
| | **Total** | **29** |

Phasing, if it has to be split:

- **Phase 1 (12 days)** — targets, achievement, Set Targets grid, import, My Target on web
  and mobile. This alone closes most of the demo gap.
- **Phase 2 (17 days)** — schemes, payouts, approval, statements.

---

## 6. Deliberately out of v1

| Excluded | Why |
|----------|-----|
| Primary vs secondary target comparison | Needs the DMS (see 1.1) |
| Distributor and retailer trade schemes | That is the existing Scheme Management module, a different thing |
| Payroll export | Quote when asked |
| Team/pooled targets rolled up from members | v2. v1 sets a manager's target directly |
| Commission on margin | We do not hold cost price reliably |
| Target versioning / mid-period revision with audit | v2. v1 edits in place and logs to the timeline |

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| A payout is disputed | The stored `breakdown` makes every rupee traceable; the statement shows the arithmetic |
| A number moves after payment | `frozen_at` on achievement and the immutable `breakdown` on an approved payout |
| Money totals wrong at scale | Every measure is one SQL aggregate RPC. Never a JS sum over `.select()` |
| Dates off by a day | Every boundary `AT TIME ZONE` the account timezone. Tested with an IST month boundary |
| We ship vendor-blog benchmarks as defaults | We ship no defaults. Every target field starts blank |
| Scope creep into trade schemes | Section 6 is the contract |

---

## 8. Open questions for the founder

1. **Which measures ship in v1?** The eight in 2.1 are the full set. If three cover the
   demand, we save ~2 days by shipping three and adding the rest later.
2. **Which owners?** Employee + territory is certain. Route and distributor — now or later?
3. **Periods:** month only in v1, or month + quarter + year?
4. **Payout modes:** slab-flat is certain. Is marginal actually needed, or only flat +
   slab-flat + threshold + accelerator?
5. **Approval:** is `requires_approval` always on, or a per-scheme switch?
6. **Plan gating:** SFA and CRM+SFA only, as proposed in section 4?
7. **Pricing:** is Targets inside the SFA plan, or a paid add-on? This changes the gate.

---

## 9. Sources

Indicative only, and almost entirely vendor marketing. Used to decide what the module must
be *able* to express, never to set a default. Sources disagree with each other, which is
itself the finding.

**Targets, KPIs and the primary/secondary distinction**
- [MAssist — 10 KPIs every FMCG sales manager must track, with benchmarks](https://blog.massistcrm.com/10-kpis-every-fmcg-sales-manager-must-track-with-benchmarks)
- [MAssist — Primary vs Secondary vs Tertiary sales in FMCG](https://blog.massistcrm.com/primary-secondary-tertiary-sales-fmcg)
- [Rework — FMCG sales KPIs and metrics dashboard](https://resources.rework.com/libraries/fmcg-distribution-growth/fmcg-sales-kpis-metrics)
- [Spirestock — Beat planning software for FMCG India](https://spirestock.com/blog/beat-planning-software-fmcg-india)
- [Spirestock — Increase distributor sales, FMCG India](https://spirestock.com/blog/increase-distributor-sales-fmcg-india)
- [FireAI — FMCG beat productivity calculator](https://fireai.in/tools/fmcg-beat-productivity-calculator)
- [FireAI — How Indian distributors track beat coverage](https://fireai.in/answers/how/analytics-for-indian-distributors)

**Incentive structures and payout mechanics**
- [Dukaankit — Slab sales commission calculator](https://www.dukaankit.in/tools/sales-commission-calculator.html)
- [SalesToolkit — Sales incentive calculator (slabs)](https://salestoolkit.in/sales-incentive-calculator)
- [AttendoHR — Incentive calculator](https://attendohr.com/free-tools/incentive-calculator)
- [HelloGrowth — Sales commission structures in India](https://hellogrowthcrm.com/blog/sales-commission-structures-india)
- [SalaryBox — What is variable pay? India-specific guide](https://salarybox.in/blog/what-is-variable-pay-types-calculation-india-specific-guide/)
- [Spirestock — FMCG salesman attrition crisis, India](https://spirestock.com/blog/fmcg-salesman-attrition-distributor-india)
- [Spirestock — Trade scheme types and structures in FMCG](https://spirestock.com/blog/scheme-management-fmcg-guide)

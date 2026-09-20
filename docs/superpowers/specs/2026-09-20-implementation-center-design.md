# Implementation Center — Design Spec

**Date:** 2026-09-20
**Status:** Approved for implementation (Phase 1)
**Internal name:** Implementation Center · **Customer-facing name:** "Getting Started"
**Author:** Claude (Opus 4.8) with founder review

---

## 1. Purpose & scope

Build a configuration-driven onboarding/implementation engine so OZZO customers can
self-complete setup without support calls. The engine is **product-agnostic** (reusable across
WFA, SFA, CRM, and future lines) and ships in Phase 1 with a single live template: **WFA v1**.

**Design principle:** template *definitions* are global, OZZO-authored, and versioned. Per-account
*runtime* state (progress, answers, analytics) is multi-tenant. Validation rules are **declared as
data** but **resolved in typed, tested TypeScript** — the DB never carries executable SQL.

### In scope (Phase 1 — this build)
- DB schema: definition tables + runtime tables + analytics + health/milestones/media/discovery.
- WFA v1 template seeded via migration (8 steps + discovery + milestones + recommended tips).
- Validation resolver registry (live EXISTS/COUNT against real OZZO entities).
- Web "Getting Started" Center: hero (progress ring, score, health, badges, est. time), journey
  rail, active-step panel (Watch/Read/Screenshots, task checklist, questions, live validation,
  Re-check, Skip, Mark done, Need Help).
- Analytics events (funnel / drop-off / step completion / help-requested / milestone-reached).
- Rights + plan-aware gating + sidebar entry.

### Out of scope (Phase 2 — schema supports, UI deferred, YAGNI now)
- Superadmin no-code template editor (seed via migration for v1).
- Cross-tenant drop-off analytics dashboard for OZZO (events exist from day one).
- CRM and SFA templates (data + resolver keys only, no engine change).
- Mobile surface of the Center (underlying activities already happen on mobile).

---

## 2. Terminology & the three numbers

Three distinct, separately-displayed measures — do not conflate:

| Measure | Definition | Purpose |
|---|---|---|
| **Progress %** | resolved steps ÷ applicable steps (resolved = completed \| auto_completed \| skipped) | "how far through the checklist" |
| **Implementation Score** | `round(100 × Σweight(completed\|auto_completed) ÷ Σweight(applicable))`; skipped steps earn 0 | "how completely set up" — skipping costs score but not progress |
| **Implementation Health** | weighted attainment of live counts vs each rule's `recommended_threshold` | "how usable the setup is in practice" (1 territory = complete but unhealthy) |

- **Applicable steps** = required steps minus steps hidden by `impl_conditions`. Optional steps are
  applicable only once viewed/available; a skipped optional step is resolved but scores 0.
- **Badges**: milestone badges at 25/50/75/100% Progress + a per-step completion badge.
- **Next recommended action** = the first `available`, non-complete, non-skipped applicable step.

---

## 3. Database schema

All new tables prefixed `impl_`. Definition tables are **global** (no `account_id`, superadmin
write, tenant read-only). Runtime tables are **multi-tenant** (`account_id`, RLS via
`is_account_member(account_id)` for read, `is_account_member(account_id,'admin')` or owner for
write). Migration file: `supabase/migrations/20260920120000_implementation_center.sql`.

### 3.1 Definition tables (global, versioned, superadmin-writable)

**`impl_templates`**
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| product_line | text | check in ('crm','wfa','sfa') |
| template_key | text | e.g. `wfa_v1` |
| version | int | default 1 |
| name | text | internal name |
| display_name | text | customer-facing (e.g. "Getting Started with Field Force") |
| description | text | |
| estimated_minutes | int | total est. time |
| support_whatsapp_url | text | Need-Help default channel (per-step override in `impl_steps`) |
| is_active | bool | default true |
| created_at / updated_at | timestamptz | |

Unique `(template_key, version)`. One active version per `template_key` enforced in code (resolver
picks max active version).

**`impl_steps`**
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| template_id | uuid fk → impl_templates | |
| position | int | ordering |
| step_key | text | stable id within template (e.g. `territory_setup`) |
| step_type | text | check in ('task','discovery','milestone_gate'); default 'task' |
| title | text | |
| description | text | |
| video_url | text | primary video (nullable) |
| quick_steps | jsonb | array of short strings — the "Read 30 sec" version |
| help_text | text | inline guidance |
| help_context | text | per-step Need-Help note/override (nullable) |
| estimated_minutes | int | |
| is_optional | bool | skippable if true |
| auto_complete | bool | auto-mark when validation passes |
| weight | numeric | score weight (default 1) |
| created_at | timestamptz | |

Unique `(template_id, step_key)`.

**`impl_step_tasks`** — the in-step checklist (deep links into the real app)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| step_id | uuid fk → impl_steps | |
| position | int | |
| label | text | e.g. "Create your first territory" |
| help_text | text | nullable |
| deep_link | text | app route, e.g. `/territories` |
| optional | bool | default false |

**`impl_step_questions`** — questions on a step (drives Step 2 + discovery)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| step_id | uuid fk → impl_steps | |
| position | int | |
| question_key | text | stable, unique within template |
| label | text | |
| input_type | text | check in ('single_select','multi_select','text','bool') |
| options | jsonb | array of `{value,label,recommended_badge?,note?}` — carries OZZO tips (#8) |
| required | bool | default false |

**`impl_step_media`** — screenshots / extra media (#5)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| step_id | uuid fk → impl_steps | |
| position | int | |
| media_type | text | check in ('image','video') |
| url | text | |
| caption | text | nullable |

**`impl_validation_rules`** — declarative, carries both bars (#2)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| step_id | uuid fk → impl_steps | |
| source_key | text | resolver name (see §4) |
| operator | text | check in ('gt','gte','eq','exists') |
| required_threshold | numeric | drives auto-complete (nullable for 'exists') |
| recommended_threshold | numeric | drives Health (nullable) |
| health_weight | numeric | weight of this metric in Health score (nullable → excluded) |
| params | jsonb | resolver params (nullable) |
| combine | text | check in ('and','or'); default 'and' — how multiple rules on one step combine |

**`impl_conditions`** — conditional branching from answers (#6)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| step_id | uuid fk → impl_steps | the step whose applicability is conditional |
| depends_on_question_key | text | question whose answer is tested |
| comparator | text | check in ('eq','neq','in','not_in','truthy') |
| value | jsonb | comparison value |
| effect | text | check in ('show','hide','require','skip') |

**`impl_milestones`** — celebration markers (#4)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| template_id | uuid fk → impl_templates | |
| position | int | |
| milestone_key | text | stable |
| title | text | e.g. "Your team is ready for the mobile app" |
| message | text | |
| icon | text | lucide icon name (nullable) |
| trigger_step_key | text | fires when this step reaches completed/auto_completed |

Unique `(template_id, milestone_key)`.

### 3.2 Runtime tables (multi-tenant, RLS)

**`impl_progress`** — one enrollment per `(account_id, template_key)`
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid fk → accounts | |
| template_id | uuid fk → impl_templates | |
| template_key | text | denormalized for the unique guard |
| template_version | int | version enrolled on |
| status | text | check in ('not_started','in_progress','completed'); default 'in_progress' |
| current_step_id | uuid | resume pointer (#7) |
| progress_pct | int | cached, recomputed on each evaluation |
| score | numeric | cached |
| health_pct | int | cached |
| started_at / completed_at / updated_at | timestamptz | |

Unique `(account_id, template_key)`.

**`impl_step_progress`**
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid | denormalized for RLS |
| progress_id | uuid fk → impl_progress | |
| step_id | uuid fk → impl_steps | |
| status | text | check in ('locked','available','in_progress','completed','auto_completed','skipped') |
| auto | bool | true when auto_completed by resolver |
| completed_by | uuid | profiles.id (nullable) |
| last_checked_at | timestamptz | |
| validation_snapshot | jsonb | what the resolver saw (counts, booleans) |
| completed_at | timestamptz | |

Unique `(progress_id, step_id)`.

**`impl_answers`** — question answers (feed conditions #6, tips #8, assignment method)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid | |
| progress_id | uuid fk → impl_progress | |
| question_key | text | |
| value | jsonb | |
| answered_by | uuid | profiles.id |
| answered_at | timestamptz | |

Unique `(progress_id, question_key)`.

**`impl_task_progress`** — checklist ticks
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid | |
| progress_id | uuid fk → impl_progress | |
| task_id | uuid fk → impl_step_tasks | |
| done | bool | |
| done_by | uuid / done_at | |

Unique `(progress_id, task_id)`.

**`impl_milestone_progress`**
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid | |
| progress_id | uuid fk → impl_progress | |
| milestone_id | uuid fk → impl_milestones | |
| reached_at | timestamptz | |
| acknowledged | bool | default false (so the celebration shows once) |

Unique `(progress_id, milestone_id)`.

**`impl_analytics_events`** — append-only funnel
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid | |
| progress_id | uuid | nullable |
| template_id | uuid | |
| step_id | uuid | nullable |
| event_type | text | see enumerated list below |
| actor_id | uuid | profiles.id (nullable) |
| metadata | jsonb | |
| created_at | timestamptz | default now() |

`event_type` ∈ {`template_started`, `step_viewed`, `step_started`, `step_completed`,
`step_auto_completed`, `step_skipped`, `validation_failed`, `video_played`, `task_toggled`,
`question_answered`, `help_requested`, `milestone_reached`, `template_completed`}. Append-only;
no update/delete. Powers drop-off + step completion rates in Phase 2, and the `help_requested`
event is the stuck-customer signal (#3).

### 3.3 Indexes & RLS
- FK indexes on every `*_id` column (matches the repo's perf convention).
- Definition tables: `SELECT` to any authenticated member; `INSERT/UPDATE/DELETE` restricted to
  superadmin (via existing superadmin guard / service role). Tenants never write definitions.
- Runtime tables: RLS `SELECT` = `is_account_member(account_id)`; `INSERT/UPDATE` =
  `is_account_member(account_id,'admin')` OR account owner. `impl_analytics_events` INSERT allowed
  to any member (events are actor-attributed), no UPDATE/DELETE policy.

---

## 4. Validation resolver

A typed registry in `src/lib/implementation/resolvers.ts`:

```ts
type ResolverResult = { value: number | boolean; detail?: Record<string, unknown> };
type Resolver = (ctx: { accountId: string; supabase: SupabaseClient; params?: Json;
                        answers: Record<string, unknown> }) => Promise<ResolverResult>;
const RESOLVERS: Record<string, Resolver> = { /* … */ };
```

Rules in `impl_validation_rules` reference `source_key`; the resolver runs the real query. **No SQL
comes from the DB.** WFA-v1 resolvers, all against verified real tables:

| source_key | query (scoped by account_id) |
|---|---|
| `territory_count` | count `territories` |
| `customer_count` | count `contacts` |
| `role_count` | count `employee_roles` where status='active' |
| `employee_count` | count `profiles` (team members of the account) |
| `employee_logged_in` | exists a non-owner with `member_presence.last_seen_at` OR any `tracking_sessions` row |
| `attendance_or_visit` | exists `tracking_sessions` OR `site_visits` |
| `meaningful_data` | `location_pings > 0` OR `site_visits ≥ 1` OR `tracking_sessions ≥ 1` (replaces `reports_opened`) |
| `answer` | reads `impl_answers[params.question_key]` (Step 2 assignment method) |

**Evaluation pipeline** (`src/lib/implementation/evaluate.ts`, called by a server action on Center
load and on "Re-check"):
1. Load template (max active version for the account's granted line), steps, rules, conditions,
   answers, existing step_progress.
2. Compute applicable steps (apply `impl_conditions` against answers).
3. For each applicable step: run its rules via resolvers, combine per `combine`.
   - If step `auto_complete` and rules pass and status ∉ {completed, skipped}: set
     `auto_completed`, write `validation_snapshot`, emit `step_auto_completed`, fire any milestone
     whose `trigger_step_key` = this step.
   - Persist `last_checked_at` + snapshot regardless.
4. Recompute Progress %, Score, Health % (Health from `recommended_threshold`/`health_weight`
   across rules) and cache on `impl_progress`.
5. Set `current_step_id` = next recommended action.
6. If all applicable required steps resolved → `impl_progress.status='completed'`, emit
   `template_completed`.

Evaluation is **idempotent** and safe to re-run. No background cron in Phase 1 (on-load + manual
Re-check is enough); a nightly sweep is a trivial Phase-2 add using the same function.

---

## 5. WFA v1 template (seeded content)

Product line `wfa`, `template_key = wfa_v1`, display_name "Getting Started with Field Force".

**Discovery step** (`step_type='discovery'`, optional, light for WFA): questions `industry`
(single_select), `team_size` (single_select: 1–5 / 6–20 / 21–50 / 50+). Answers stored for future
branching; no hard gating in WFA.

| # | step_key | title | required rule | recommended (health) | milestone on complete |
|---|---|---|---|---|---|
| 1 | territory_setup | Set up your territories | `territory_count gt 0` | ≥5 | — |
| 2 | assignment_method | Choose how you assign customers | `answer(customer_assignment_method) exists` | — | — |
| 3 | customer_creation | Add your customers | `customer_count gt 0` | ≥100 | — |
| 4 | role_creation | Create roles | `role_count gt 0` | ≥3 | — |
| 5 | employee_creation | Add your employees | `employee_count gt 0` | ≥5 | M1 "Your team is ready for the mobile app" |
| 6 | mobile_login | Get the team on the mobile app | `employee_logged_in exists` | — | M2 "Your first field user is active" |
| 7 | first_activity | Record your first activity | `attendance_or_visit exists` | — | M3 "Live field tracking is working" |
| 8 | see_live_data | See your live data | `meaningful_data exists` | — | M4 "You're live on OZZO" |

- **Step 2** question `customer_assignment_method` (single_select): options
  `area_wise` → badge "Recommended by OZZO ✓", note "Best for 50+ customers";
  `direct` → note "Best for smaller teams". (#8) Selecting `area_wise` sets an `impl_conditions`
  effect that surfaces an "assign areas to employees" task on step 5 (deep-link to area assignment);
  `direct` hides it. (#6 branching, exercised even in WFA.)
- Each step carries `video_url` (nullable placeholder for now), `quick_steps` (Read version), and a
  task checklist deep-linking to the real page (`/territories`, `/contacts`, `/team`, etc.).
- Support: `support_whatsapp_url` set at template level; Need-Help emits `help_requested`.

> **Content note:** video URLs and screenshots are content, not code. Phase 1 seeds the structure,
> `quick_steps`, help text, and task checklists (real, usable). `video_url`/`impl_step_media` are
> seeded where available and left null otherwise — the UI degrades gracefully (Read tab always
> present; Watch/Screenshots tabs hidden when absent). No fake/placeholder video links are invented.

---

## 6. Web UI

Route `src/app/(dashboard)/getting-started/page.tsx`. Admin/owner only, plan-aware.

- **Hero:** `display_name`, animated **progress ring** (Progress %), **Implementation Score**,
  **Health** summary chip, earned **badges**, **estimated time remaining**, primary **Resume** CTA
  → next recommended action.
- **Journey rail (left):** vertical timeline of step cards — status pill
  (done/auto/available/locked/skipped), title, est. time, completion badge. Collapses to accordion
  on mobile.
- **Active step panel (main):**
  - Content tabs **Watch / Read / Screenshots** (#5) — Read always present; others shown only when
    media exists.
  - **Task checklist** with deep links carrying `?from=getting-started&step=<step_key>` (#7); target
    pages show a "← Back to Getting Started" chip (small shared component).
  - **Question inputs** (Step 2 + discovery) with **OZZO recommendation** badge/note under options
    (#8); answering emits `question_answered` and re-runs conditions.
  - **Live validation status** ("Territories: 3 ✓ · recommended 5 ⚠️"), **Re-check** button.
  - **Skip** (optional steps), **Mark done** (manual/non-auto steps), **Need Help?** (#3) → opens
    `support_whatsapp_url`, emits `help_requested`.
- **Milestone celebration** (#4): when a milestone is newly reached and unacknowledged, show a
  dismissible celebration card; dismiss sets `acknowledged=true`.
- **Health panel:** per-metric rows (Territories 1 ⚠️ / recommended 5, Customers 2 ⚠️ / 100, …) +
  overall Health Score. Purely informational; never blocks completion.
- Built on existing `@/components/ui/*` (shadcn), `sonner`, `lucide-react`; follows the repo's
  direct-`createClient()` data pattern (not the dead DDD layer). Fully responsive.

**Return-chip component:** `src/components/getting-started/BackToGettingStarted.tsx` — renders when
`?from=getting-started` is present on any deep-linked page; links back to `/getting-started?step=…`.

---

## 7. Gating, rights, nav

- New permission keys in `src/lib/auth/permissions-registry.ts`, group `IMPLEMENTATION`, canonical
  strings `view_implementation` and `manage_implementation`. Owner/admin bypass as usual; the Center
  is admin/owner-facing in v1.
- **Plan-aware:** the Center offers a template only when `planLines(account.subscription_plan)`
  grants that template's `product_line`. WFA v1 shows when the plan includes `wfa`
  (WFA / CRM_WFA / SFA / CRM_SFA, plus legacy full-access plans).
- **Sidebar:** "Getting Started" entry (lucide `Rocket`/`Compass`), surfaced while the active
  template is incomplete; can be dismissed/minimized once `status='completed'`.

---

## 8. File map (Phase 1)

```
supabase/migrations/20260920120000_implementation_center.sql   # schema + RLS + indexes
supabase/migrations/20260920120100_seed_wfa_v1_template.sql     # WFA v1 definition seed
src/lib/implementation/types.ts            # shared TS types for rows + evaluated view
src/lib/implementation/resolvers.ts        # source_key → resolver registry (tested)
src/lib/implementation/resolvers.test.ts
src/lib/implementation/evaluate.ts         # evaluation pipeline (tested)
src/lib/implementation/evaluate.test.ts
src/lib/implementation/scoring.ts          # progress/score/health pure fns (tested)
src/lib/implementation/scoring.test.ts
src/app/(dashboard)/getting-started/page.tsx
src/app/(dashboard)/getting-started/actions.ts   # server actions: load, answer, recheck, skip, mark-done, help, ack-milestone
src/components/getting-started/*.tsx        # Hero, JourneyRail, StepPanel, HealthPanel, MilestoneCard, ContentTabs
src/components/getting-started/BackToGettingStarted.tsx
```

- **Tests (vitest, `src/**/*.test.ts`):** scoring pure functions (progress/score/health incl. skip
  and hidden-step cases), the resolver registry (mocked supabase), and the evaluation pipeline
  (auto-complete transitions, milestone firing, idempotency).
- Verify with `npm run typecheck` and `npm run build`; paste real output.

---

## 9. Reusability path (CRM / SFA)

Adding a future template is **data + resolver keys only**:
1. Insert `impl_templates` row (`product_line`, new `template_key`).
2. Insert steps/tasks/questions/rules/conditions/milestones/media.
3. Register any new `source_key` resolvers (e.g. `order_count`, `payment_count`, `deal_count`,
   `pipeline_count`, `whatsapp_connected`, `scheme_count`, `stock_seeded`) in `resolvers.ts`.

No changes to schema, evaluation, scoring, or UI. Discovery-step support (already built) lets SFA
branch heavily on answers (takes orders? collects payments? tracks stock? uses routes/schemes?)
without redesign. Candidate resolver sources already present in OZZO: `orders`, `order_dispatches`,
`payments`, `schemes`, `price_lists`, `stock_ledger`, `deals`, `pipelines`, `products`,
`quotations`, `whatsapp_config`, `automations`, `custom_fields`, `expenses`, `routes`.

---

## 10. Rollout

Founder standing rules: applies to all tenants + future signups; commit + push to `main`
(Vercel deploys `main`); definitions are global so every tenant gets WFA v1 automatically. DB
migration application is a manual Supabase step (per prior convention) — the spec's migrations are
authored and committed; applying to prod is called out explicitly, not silently assumed. A rollback
note (`ROLLBACK-implementation-center.md`) drops the `impl_*` tables.

@AGENTS.md

# CLAUDE.md — WACRM Web (wacrm-web)

This file loads at the start of every session. It is the source of truth for how this project is
built and how you must work in it. Read it fully before writing any code.

Note the `@AGENTS.md` import above: this repo runs **Next.js 16**, which has breaking changes from
older versions. Do not assume App Router conventions you remember — check
`node_modules/next/dist/docs/` when unsure.

## What this project is

WACRM = multi-tenant B2B SaaS: CRM + WhatsApp CRM + Field Force Tracking. This repo (`wacrm-web`)
is the **Next.js admin web app**. The Android field app is a separate repo (`wacrm-mobile`,
React Native / Expo). Backend is **Supabase (Postgres + Auth + Storage + Realtime + RLS)** —
shared by both repos. A schema change here affects mobile, and vice versa.

## Tech stack (do not deviate without asking)

- **Next.js 16.2.6**, React 19.2.4, App Router (`src/app/`), TypeScript strict mode
- Supabase via `@supabase/ssr` ^0.10.3 + `@supabase/supabase-js` ^2.107.0
  - Browser/client components: `@/lib/supabase/client` → `createClient()`
  - Server components / route handlers: `@/lib/supabase/server`
- UI: Tailwind + shadcn/ui components under `@/components/ui/*`, `sonner` for toasts,
  `lucide-react` for icons
- **Edge middleware lives in `src/proxy.ts` and exports `proxy()`** — NOT `src/middleware.ts`
  exporting `middleware()`. This is the Next.js 16 convention. Do not "restore" middleware.ts.
- Tests: **vitest**, configured in `vitest.config.ts` to match **`src/**/*.test.ts(x)` only**.
  Files named `*.spec.ts` are NOT picked up by `npm test`.

Scripts: `npm run dev` · `npm run build` · `npm run typecheck` (`tsc --noEmit`) ·
`npm run lint` · `npm test` (`vitest run`)

## Absolute rules

1. **No fabricated stubs, mock services, or placeholder implementations presented as working code.**
   If something is not built, say so plainly and leave it unbuilt. A hollow shell that looks
   finished is worse than an honest "not built yet." This repo previously accumulated an entire
   fake "DDD" Order layer — empty repositories, invented entity fields, a service full of
   hardcoded mock lookups — which cost real time to untangle. Do not recreate that pattern.
2. **NEVER generate test, benchmark, validation, performance, or go/no-go reports for work you
   did not actually run.** Do not write files that assert `passed: true` without executing a real
   check. Do not write Markdown reports containing numbers you did not measure. If you ran
   something, paste its real output. If you did not run it, say you did not run it. This repo
   previously contained twelve such fabricated reports and fifteen generators that produced them.
3. **No `any` without a justifying comment.** TypeScript is strict. `Record<string, any>` for
   database rows is the most common offender here — type the shape instead.
4. **Multi-tenant: every query must be scoped by `account_id` and respect RLS.** Get `accountId`
   from `useAuth()` (client) or the session (server). RLS is enforced in Postgres via
   `is_account_member(account_id)` / `is_account_member(account_id, 'admin')`, but never rely on
   RLS alone — always filter explicitly. Realtime subscriptions must filter by `account_id` too.
5. **Reuse before create; extend before replace.** Search for an existing component, hook, or
   helper first. `@/components/ui/*`, `@/hooks/use-auth`, `@/lib/currency`, `@/lib/date-filters`,
   and the `@/components/ui/data-table` family already cover most needs.
6. **Report real command output.** Run `npm run typecheck` and `npm run build` after changes and
   paste what they actually printed — never claim a clean build you did not run.
7. **Never generate record numbers client-side** when the database already assigns them. See the
   Order schema below.

## Live code vs. dead code (read this before "improving" anything)

This repo contains a large parallel architecture that **nothing in the UI uses**. Verified by
import search:

| Path | Status |
|---|---|
| `src/app/**`, `src/components/**` (except providers) | **LIVE** — the real application |
| `src/hooks/use-auth`, `src/lib/supabase/*`, `src/lib/currency`, `src/lib/date-filters` | **LIVE** |
| `src/lib/domain/**`, `src/lib/application/**`, `src/lib/repositories/**`, `src/lib/runtime/**`, `src/lib/presentation/**` | **NOT used by any page or component** |
| `src/hooks/features/*` (`useContacts`, `useLeads`, `useAccounts`, …) | **NOT used by any page or component** |
| `src/components/providers/ApplicationProvider.tsx` | **Never mounted in any layout** |

The live pages talk to Supabase **directly** via `createClient()`. That is the working pattern in
this repo — follow it. Do not wire new features through the unused DDD layers, and do not assume
those layers work just because they compile. `@nozbe/watermelondb` and `src/lib/runtime` are part
of that unused stack; the web app does not use offline storage.

If you think a piece of dead code should be removed, propose it — do not delete it silently.

## Database — real schema (verified against production)

Multi-tenant. `account_id` on almost every table. RLS via `is_account_member(account_id, role)`.

### Customers live in `contacts`

There is no `customers` table. A customer is a row in `contacts`.

- The **company/firm name is the primary identifier** (`contacts.company`); `contacts.name` is the
  contact *person*. The lead-conversion RPC `convert_lead_to_customer` maps
  `lead.name → contact.company` and `lead.contact_person → contact.name`.
- `contacts.hierarchy_level` (integer, nullable) holds the customer's distribution tier. It is
  meaningful only when hierarchy is enabled, and its values map by **position** into
  `accounts.settings.order_settings.levels` — a JSON array of `{ position, name, color }`
  configured in Settings → Order. Level 1 is the top of the chain.
- **`leads` has NO `company` column.** Lead fields are `name`, `contact_person`, `whatsapp`,
  `email`, `source`, `status`, `industry`, `address`, `city`, `state`, `country`,
  `latitude`, `longitude`, `is_converted`, `converted_contact_id`, `collaborator_id`.
  Selecting `company` from `leads` throws Postgres error `42703`.

### Orders

Tables: `orders`, `order_items`, `order_statuses`, `order_dispatches`, `dispatch_items`,
`order_custom_values`. Defined in `supabase/migrations/068_orders_module.sql`.

- **Order and dispatch numbers are assigned server-side by triggers** —
  `trg_set_order_number` → `ORD-0001`, `trg_set_dispatch_number` → `DSP-0001`, both drawing from
  `account_sequences`. **Never generate these client-side.** Insert without the number field and
  let the trigger fill it.
- **`orders.status` is free TEXT holding the status *name*, not a foreign key** to
  `order_statuses.id`. Renaming or deleting a status therefore orphans existing orders. Keep this
  in mind before changing status handling.
- **`orders.classification`** (`'direct' | 'primary' | 'secondary'`, CHECK-constrained, defaults
  to `'direct'`) is currently **written by nothing** — no application code and no trigger sets it.
  Every order is `'direct'` today. The hierarchy feature is configured in Settings and rendered as
  a badge, but nothing computes the value in between. Do not assume it is populated.
- **An order can link to `contact_id`, `lead_id`, OR `site_visit_id`** (all nullable). Current UI
  only resolves contact and lead; `site_visit_id` is stored and indexed but never joined, so
  visit-originated orders display as "Unknown".
- `order_items` carries `tax_rate`, `tax_amount`, `sub_total` and `total`. The current detail page
  ignores tax.
- There is **no order creation UI** anywhere in this repo. Orders are intended to be created by
  the mobile field app, which has not built the module yet.

### Site visits are polymorphic

`site_visits` carries **both** a legacy `contact_id` (real FK → `contacts`) **and** a polymorphic
pair `target_type` / `target_id` (no FK, no CHECK). `target_type` values in production are the
capitalised strings `'Customer'` and `'Lead'`.

**PostgREST cannot embed the polymorphic side** — `site_visits` has no foreign key to `leads`, so
`.select('*, leads(name)')` fails. Resolve lead targets with a **separate query** keyed by
`target_id`. `src/app/(dashboard)/location-tracking/visits/page.tsx` does this correctly; copy it.

### Other tables

`leads` (+ `lead_sources`, `lead_statuses`, `lead_industries`, `lead_notes`, `lead_custom_values`),
`tasks`, `module_activities` (generic audit feed keyed by `module_name` + `record_id`, powers
timelines), `products`, `quotations`, `expenses`, `geofences`, `tracking_sessions`,
`location_pings`, `profiles`, `accounts`, `custom_fields` (shared across modules via
`module_name`), `account_sequences`.

## Conventions

- Route pages: `src/app/(dashboard)/<module>/page.tsx`, detail at `<module>/[id]/page.tsx`
- Components: kebab-case files exporting PascalCase components (`orders-settings.tsx` →
  `OrdersSettings`)
- Settings panels: `src/components/settings/*-settings.tsx`, registered in
  `src/app/(dashboard)/settings/page.tsx` and `settings-sections.ts`
- Sidebar nav: `src/components/layout/sidebar.tsx`, each item carrying an RBAC `module` key.
  Note `/orders` and `/quotations` currently share the key `"orders"` and cannot be permissioned
  separately.
- Money is rendered with `formatCurrency(value, defaultCurrency)` from `@/lib/currency`

## Workflow expectations

- **Use plan mode for any non-trivial task.** Show your plan and wait for approval before
  implementing.
- **STOP AND ASK** rather than assume when: the spec does not cover a case, existing code
  conflicts with the plan, you would add a dependency or a new pattern, or you would touch shared
  code affecting other features.
- **Verify against the real database before trusting a schema assumption.** Several bugs here came
  from code selecting columns that do not exist. If you can query production, query it.
- After changes run `npm run typecheck`, and `npm run build` for anything routing-related. Report
  the actual output.
- **Commit working states promptly.** The real Order module sat uncommitted and untracked for
  days, one accidental delete away from being lost.

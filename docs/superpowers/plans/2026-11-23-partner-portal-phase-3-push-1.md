# Partner Portal Phase 3, Push 1 — Proposals, Calculator, Forecast, Invoices, Invoice Settings, Renewals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OZZO's own money modules out of `wacrm-web`'s founder-only `/admin` into `partner.ozzo.co.in`, against the same live rows, gated on partner rights instead of an email address — and delete them from `/admin` in the same push.

**Architecture:** A copy, not a rewrite. The screens, the libraries and the print documents come across file-for-file; three things change in every copied file and nothing else does: `requireFounder()` becomes `requirePartnerRight(key)`, `@/lib/auth/superadmin` splits into `@/lib/auth/partner` + `@/lib/auth/partner-service`, and `/admin/x` and `/api/admin/x` paths lose their `/admin` segment. The four `platform_*` tables already have RLS enabled with **no policies at all**, so the service-role client is the only way in and the route's right check is the whole protection — which makes the order of those two lines the thing a test must pin.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4, Base UI 1.9, recharts 3.8.1 (new to this app), Supabase (`@supabase/ssr` 0.10.3) against the Mumbai project `ltigfpywdbfilsagtpyd`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-partner-portal-design.md` — the "Moved from `/admin` — same data, new home" table, the rights registry, the three non-negotiable enforcement rules, and Phase 3's *done when*.

**Repos:** the app is `C:\Wacrm\ozzo-partner` (dev port 3300). The deletions and the one migration are in `C:\Wacrm\wacrm-web`. Two working directories, as in every partner phase so far.

---

## Why this push carries six modules and not four

The founder chose three pushes: the money modules, then the tools, then the Dashboard. One fact found while reading the code moves the boundary by two modules:

```
admin/calculator/calculator-client.tsx:110   fetch("/api/admin/proposals", { method: "POST" })
admin/calculator/calculator-client.tsx:122   router.push(`/admin/proposals/${id}/edit`)
admin/forecast/forecast-client.tsx:42        fetch("/api/admin/proposals")
```

**Price Calculator and Business Forecast both call the proposals API.** Deleting `/api/admin/proposals` while they are still in `/admin` leaves two screens that load and then fail — and leaving the API behind means two homes for one proposal list, which decision 3 of the spec exists to prevent. So the cluster that shares that route moves together.

Push 2 is therefore Lead Discovery + WhatsApp Sender (plus the Chrome extension's address), and Push 3 is the Dashboard. Still three pushes.

## Global Constraints

- **Push directly to `main`** in both repos. No branches, no PRs — Vercel deploys `main`.
- **Five gates before anything is called done:** in `ozzo-partner`, `npx tsc --noEmit`, `npx vitest run`, `npx next build`, and a click-through on the running app at port 3300; in `wacrm-web`, the same three plus the DB harness for Task 10's migration.
- **No local database.** SQL is exercised only on the throwaway harness: `cd /c/Wacrm/wacrm-web && PGPORT=54437 PGDATA_DIR=<scratchpad>/pgtest-p3 bash scripts/run-db-tests.sh`. A fresh `PGPORT` and `PGDATA_DIR` per run. Roughly 47 migration errors on the way up are pre-existing; what matters is the `passed | failed` table and `All scenarios passed.`
- **The scenario list in `scripts/run-db-tests.sh` is hard-coded, not a glob.** A new `supabase/tests/*.sql` file that is not added to the `for f in …` list is never run, and the suite still reports success.
- **`requirePartnerRight()` before `serviceClient()`, in every route and every gated page.** Not a style preference: `platform_*` has RLS on with zero policies, so the service client ignores the caller entirely. A `route-shape.test.ts` per route pins the ordering, the way `app/api/leads/route-shape.test.ts` already does.
- **`requirePartnerRight()` calls `notFound()`**, which throws. API routes therefore need no `try/catch` and no `toErrorResponse` — a caller without the right gets a 404, which tells them nothing about what exists. Every `import { toErrorResponse } from "@/lib/auth/account"` is deleted, not translated.
- **Never add a second foreign key between the same pair of tables.** Task 10 adds the *first* `platform_proposals → accounts` FK; any later route from proposals to accounts uses a plain `uuid` with no constraint. This is `orders-second-fk-broke-every-order`.
- **PostgREST silently caps a result at 1,000 rows.** Every list query in this push gets an explicit `.range()` or `.limit()`, and the screen says when it is showing a window.
- **Keep file paths, component names and prop shapes identical to the originals**, and record every copied file in `ozzo-partner/COPIED-FROM.md` with its source commit, so porting a later CRM fix stays a diff rather than archaeology.
- Plain English in all user-facing copy. The founder reads these screens; he does not read terminals.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## The three mechanical edits, written once

Every copied file gets these and nothing else. Any other change is a decision, and a decision belongs in this plan explicitly.

**1. The gate.**

```ts
// before (wacrm-web)
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
await requireFounder();

// after (ozzo-partner)
import { requirePartnerRight } from "@/lib/auth/partner";
import { serviceClient } from "@/lib/auth/partner-service";
await requirePartnerRight("view_proposals");   // key per the table below
```

Where a page wrapped the gate in `try { } catch { notFound() }`, drop the wrapper: `requirePartnerRight` already calls `notFound()`.

**2. The paths.**

| In the CRM | In the portal |
|---|---|
| `/admin/proposals` | `/proposals` |
| `/admin/invoices` | `/invoices` |
| `/admin/invoice-settings` | `/settings/invoice` |
| `/admin/renewals` | `/renewals` |
| `/admin/calculator` | `/calculator` |
| `/admin/forecast` | `/forecast` |
| `/api/admin/…` | `/api/…` |
| `/print/proposal/[id]`, `/print/invoice/[id]` | unchanged |

**3. The right key, per handler.**

| Route or page | Right |
|---|---|
| `GET /api/proposals`, `/proposals`, `/proposals/[id]`, `/print/proposal/[id]` | `view_proposals` |
| `POST /api/proposals` | `create_proposals` |
| `PATCH /api/proposals/[id]`, `/proposals/[id]/edit` | `edit_proposals` |
| `DELETE /api/proposals/[id]` | `delete_proposals` |
| `GET /api/invoices`, `/invoices`, `/invoices/[id]`, `/print/invoice/[id]` | `view_invoices` |
| `POST /api/invoices`, `/invoices/new` | `create_invoices` |
| `PATCH /api/invoices/[id]`, `/invoices/[id]/edit` | `edit_invoices` |
| `GET` / `PUT /api/invoice-settings`, `/settings/invoice` | `manage_invoice_settings` |
| `GET /api/renewals`, `/renewals` | `view_renewals` |
| `POST /api/renewals`, `PATCH /api/renewals/[id]`, `POST /api/renewals/[id]/renew` | `renew_subscription` |
| `/calculator` | `view_calculator` |
| `/forecast` | `view_forecast` |

Every one of these keys already exists in `lib/auth/rights-registry.ts` and in `public.partner_has_right()`. **No rights are added in this push** — verify, do not invent.

## Two couplings that are NOT mechanical

Both are cases where copying the file faithfully would ship a bug, so each gets its own steps.

**A. Forecast must not depend on `view_proposals`.** `forecast-client.tsx` fetches `/api/admin/proposals` from the browser. Ported as-is, a person holding `view_forecast` but not `view_proposals` gets a 404 from that fetch and an empty chart with no explanation. Task 5 makes the page a server component that loads the rows itself behind `requirePartnerRight("view_forecast")` and passes them in as a prop. Fewer round trips, and one right gates one screen.

**B. The Calculator's save button needs `create_proposals`.** `calculator-client.tsx` POSTs a new proposal. `view_calculator` alone must not imply that: the seeded Sales Executive role holds `view_calculator` and not `create_proposals`. Task 4 passes `canCreateProposal` down and hides the button; the route refuses it regardless.

## File Structure

### `C:\Wacrm\ozzo-partner` — created

| File | Responsibility |
|---|---|
| `lib/currency.ts` | INR formatting, amount in words. Copy. |
| `lib/gst/states.ts` | State codes for place of supply. Copy. |
| `lib/plans/pricing.ts` | Per-user pricing and term uplifts. Copy. |
| `lib/invoices/**` | 9 modules, their tests, and `template/invoice-document.tsx`. Copy. |
| `lib/proposals/**` | 12 modules, their tests, and `templates/` including `proposal.css` and `proposal-pages.tsx`. Copy. |
| `lib/renewals/**` | `buckets`, `next-period`, `types`, and tests. Copy. |
| `components/ui/switch.tsx` | Base UI switch; invoice settings needs it. Copy. |
| `components/charts/chart-tooltip.tsx` | The one recharts tooltip. Copy. |
| `app/api/proposals/route.ts`, `[id]/route.ts`, `route-shape.test.ts` | Proposal list/create, read/update/delete, gate-order guard. |
| `app/api/invoices/route.ts`, `[id]/route.ts`, `route-shape.test.ts` | The same for invoices. |
| `app/api/invoice-settings/route.ts`, `route-shape.test.ts` | Numbering, GST, seller branding. |
| `app/api/renewals/route.ts`, `[id]/route.ts`, `[id]/renew/route.ts`, `route-shape.test.ts` | Subscriptions and the renew action. |
| `app/(portal)/proposals/{page,proposals-client}.tsx`, `[id]/{page,proposal-detail}.tsx`, `[id]/edit/{page,proposal-form}.tsx` | The proposals module. |
| `app/(portal)/invoices/{page,invoices-client,invoice-form,status-badge}.tsx`, `new/page.tsx`, `[id]/{page,invoice-detail}.tsx`, `[id]/edit/page.tsx` | The invoices module. |
| `app/(portal)/settings/invoice/{page,settings-form}.tsx` | Invoice settings, inside the existing Settings area. |
| `app/(portal)/renewals/{page,renewals-client,renew-dialog,subscription-form}.tsx` | Renewals. |
| `app/(portal)/calculator/{page,calculator-client,term-cards,quotable-plans}.tsx` + 2 tests | Price Calculator. |
| `app/(portal)/forecast/{page,forecast-client}.tsx` | Business Forecast, server-loaded. |
| `app/print/proposal/[id]/{page,download-button}.tsx` | The A4 proposal PDF. Outside `(portal)`, so no sidebar. |
| `app/print/invoice/[id]/{page,download-button}.tsx` | The A4 invoice PDF. Same. |

### `C:\Wacrm\ozzo-partner` — modified

| File | Change |
|---|---|
| `lib/plans/catalog.ts` | **Merged**, not replaced: add the CRM's `ProductLine`, `PLAN_PRICE`, `PLAN_LINES`, `MODULE_*` and helpers; keep this app's own `ADDON_IDS`, `BILLING_TERMS`, `planOptions`, `billingTermOptions`. |
| `lib/nav.ts` | `built: false → true` for Proposals, Invoices, Renewals, Price Calculator, Business Forecast. |
| `app/(portal)/settings/settings-client.tsx` | A link through to Invoice Settings, gated on `manage_invoice_settings`. |
| `app/api/customers/billing/route.ts` | Task 10: return the customer's proposals too. |
| `package.json` | `recharts: ^3.8.1`. |
| `COPIED-FROM.md` | Every file above, with its source commit. |

### `C:\Wacrm\wacrm-web` — deleted in this push

`src/app/(superadmin)/admin/{proposals,invoices,invoice-settings,renewals,calculator,forecast}/**`,
`src/app/api/admin/{proposals,invoices,invoice-settings,renewals}/**`,
`src/app/print/{proposal,invoice}/**`, and the six rows in `src/app/(superadmin)/admin/admin-shell.tsx`.

### `C:\Wacrm\wacrm-web` — added

`supabase/migrations/20261125120000_platform_proposals_account.sql`, and a scenario appended to an existing `supabase/tests/*.sql` file.

---

## Task 1: The shared libraries, the catalog merge, and two new primitives

Nothing renders until the libraries the screens import exist. This task is the whole dependency closure of the five modules, and ends with the copied tests passing in their new home — which is the cheapest possible proof the copy is faithful.

**Files:**
- Create: `lib/currency.ts`, `lib/gst/states.ts`, `lib/plans/pricing.ts`, `lib/plans/pricing.test.ts`
- Create: `lib/invoices/**` (all 17 files), `lib/proposals/**` (all 30 files), `lib/renewals/**` (all 5 files)
- Create: `components/ui/switch.tsx`, `components/charts/chart-tooltip.tsx`
- Modify: `lib/plans/catalog.ts` (merge), `package.json` (recharts), `COPIED-FROM.md`

**Interfaces:**
- Produces, for every later task: `PLAN_PRICE`, `PLAN_LABEL`, `PLAN_LINES`, `type PlanId` from `@/lib/plans/catalog`; `quoteFor`, term uplifts from `@/lib/plans/pricing`; `type InvoiceRow`, `type InvoiceItem` from `@/lib/invoices/types`; `invoiceTotals` from `@/lib/invoices/totals`; `nextInvoiceNo` from `@/lib/invoices/number`; `InvoiceDocument` from `@/lib/invoices/template/invoice-document`; `type ProposalData`, `type ProposalRow` from `@/lib/proposals/types`; `inr` from `@/lib/proposals/format`; `summarise`, `type ForecastRow`, `type ForecastBasis`, `BASIS_LABEL`, `FORECAST_BASES`, `MIN_DECIDED_FOR_WIN_RATE` from `@/lib/proposals/forecast`; `type SubscriptionRow` from `@/lib/renewals/types`; `bucketFor` from `@/lib/renewals/buckets`; `nextPeriod` from `@/lib/renewals/next-period`; `Switch` from `@/components/ui/switch`; `chartTooltipProps` from `@/components/charts/chart-tooltip`.

- [ ] **Step 1: Copy the library trees whole, tests included**

Run from `/c/Wacrm`:

```bash
cd /c/Wacrm
cp wacrm-web/src/lib/currency.ts            ozzo-partner/lib/currency.ts
mkdir -p ozzo-partner/lib/gst
cp wacrm-web/src/lib/gst/states.ts          ozzo-partner/lib/gst/states.ts
cp wacrm-web/src/lib/plans/pricing.ts       ozzo-partner/lib/plans/pricing.ts
cp wacrm-web/src/lib/plans/pricing.test.ts  ozzo-partner/lib/plans/pricing.test.ts
cp -r wacrm-web/src/lib/invoices            ozzo-partner/lib/invoices
cp -r wacrm-web/src/lib/proposals           ozzo-partner/lib/proposals
cp -r wacrm-web/src/lib/renewals            ozzo-partner/lib/renewals
mkdir -p ozzo-partner/components/charts
cp wacrm-web/src/components/charts/chart-tooltip.tsx ozzo-partner/components/charts/chart-tooltip.tsx
cp wacrm-web/src/components/ui/switch.tsx            ozzo-partner/components/ui/switch.tsx
```

The tests come across deliberately. They are already written, they exercise pure functions with no database, and they are the only evidence that a 10,000-line copy did not lose a line.

- [ ] **Step 2: Add recharts**

```bash
cd /c/Wacrm/ozzo-partner && npm install recharts@^3.8.1
```

Pin the same major as `wacrm-web` (3.8.1). A different major silently changes `<ResponsiveContainer>` sizing behaviour, and the Forecast chart is the only consumer, so a mismatch would show up as an invisible chart rather than an error.

- [ ] **Step 3: Merge the plan catalog — do not overwrite it**

`ozzo-partner/lib/plans/catalog.ts` is **not** a copy of the CRM's; it is a 104-line subset written for this app, and it exports four things the CRM's does not: `ADDON_IDS`, `BILLING_TERMS`, `planOptions()`, `billingTermOptions()`. `app/(portal)/customers/customer-form.tsx` imports two of them. Replacing the file breaks the customer form.

The eight plan ids and all eight labels are already identical in both files — verified before writing this plan — so the merge is additive. Append to `ozzo-partner/lib/plans/catalog.ts` everything the CRM's file has that this one lacks:

```ts
// ─────────────────────────────────────────────────────────────
// Added in Phase 3 Push 1, from wacrm-web/src/lib/plans/catalog.ts.
//
// The eight PLAN_IDS and PLAN_LABEL above were already byte-identical to the
// CRM's, so this is additive: nothing that existed changed meaning. What the
// proposals, calculator and invoice modules need from the CRM's catalogue and
// this file did not have is the price list, the product lines and the module
// map.
// ─────────────────────────────────────────────────────────────

export type ProductLine = "crm" | "wfa" | "sfa" | "fsm" | "dms";

/** Per-user monthly price in INR (annual base). */
export const PLAN_PRICE: Record<PlanId, number> = {
  CRM: 100,
  WFA: 150,
  CRM_WFA: 200,
  SFA: 300,
  CRM_SFA: 400,
  // PLACEHOLDERS — not founder-approved (FSM spec section 10 ruling 1).
  // Do not publish these prices until they are confirmed.
  FSM: 500,
  CRM_FSM: 600,
  SFA_FSM: 800,
};
```

Then copy across, verbatim from the CRM file, every remaining export the new libraries reference: `ADDON_LINES`, `ADDON_LABEL`, `accountHasAddonLine`, `PLAN_LINES`, `ModuleKey`, `MODULE_KEYS`, `MODULE_LINE`, `isNewPlan`, `planLines`, `accountLines`, `planHasLine`, `allowedModules`, `defaultModuleSettings`, `clampModuleSettings`. Keep the CRM's comments: each one records a decision.

Name clash to watch: the CRM also exports `ADDON_LINES`/`ADDON_LABEL` keyed on `"dms"` lower-case, while this app has `ADDON_IDS = ["DMS"]`. They are different things — a product line versus a thing a customer bought — and both keep their names. Do not try to unify them in this task.

- [ ] **Step 4: Run the copied tests and watch them pass**

```bash
cd /c/Wacrm/ozzo-partner && npx vitest run lib/invoices lib/proposals lib/renewals lib/plans
```

Expected: every suite passes. A failure here is a missing dependency in the merge of Step 3, not a bug in the library — read the import it names and add that export.

- [ ] **Step 5: Typecheck**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit
```

Expected: clean. If a copied library imports something genuinely absent (`@/lib/supabase/admin`, say), stop and record it here rather than inventing a shim.

- [ ] **Step 6: Record the copies**

Add a block to `ozzo-partner/COPIED-FROM.md` under "Copied unchanged", listing each tree and the `wacrm-web` commit it came from (`git -C /c/Wacrm/wacrm-web rev-parse --short HEAD`). Update the "Source commits at first copy" line to note that Phase 3 copied from a later commit.

- [ ] **Step 7: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "$(cat <<'MSG'
feat(partner): copy the invoice, proposal and renewal libraries

The dependency closure of Phase 3 Push 1's six modules: lib/invoices,
lib/proposals, lib/renewals, lib/plans/pricing, lib/gst/states,
lib/currency, the recharts tooltip and the Base UI switch.

lib/plans/catalog.ts is MERGED, not replaced — this app's own
planOptions()/billingTermOptions()/ADDON_IDS are used by the customer
form, and the CRM's catalogue does not have them. The eight plan ids
were already identical in both files, so the merge is additive.

Tests came across with the libraries. They are pure functions with no
database, and they are the only evidence a copy this size lost nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: The proposals API

**Files:**
- Create: `app/api/proposals/route.ts` (from `wacrm-web/src/app/api/admin/proposals/route.ts`)
- Create: `app/api/proposals/[id]/route.ts` (from the CRM's `[id]/route.ts`)
- Create: `app/api/proposals/route-shape.test.ts`

**Interfaces:**
- Consumes: `requirePartnerRight` (`@/lib/auth/partner`), `serviceClient` (`@/lib/auth/partner-service`), `type ProposalData` (`@/lib/proposals/types`), `nextRef` (`@/lib/proposals/ref`), `todayInIndia` (`@/lib/proposals/today`).
- Produces: `GET /api/proposals` → `{ proposals: ProposalRow[] }`; `POST /api/proposals` → `{ id: string }`; `GET|PATCH|DELETE /api/proposals/[id]`. The response envelopes are unchanged from the CRM, because the client files copied in Task 3 read them.

- [ ] **Step 1: Write the failing guard test first**

This is the one test that must be seen to fail, because it guards the rule that `platform_*`'s absent policies make load-bearing.

Create `app/api/proposals/route-shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two files, one rule: the caller's right is checked on their own session
// before a service client exists. platform_proposals has RLS enabled with NO
// policies, so the service client sees every row of OZZO's own pricing
// regardless of who asked. The order of these two lines IS the access control.
const list = readFileSync(join(process.cwd(), "app", "api", "proposals", "route.ts"), "utf8");
const one = readFileSync(join(process.cwd(), "app", "api", "proposals", "[id]", "route.ts"), "utf8");

function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the proposals routes", () => {
  it("checks the right before building a service client", () => {
    const cases: [string, string][] = [
      [list, "GET"],
      [list, "POST"],
      [one, "GET"],
      [one, "PATCH"],
      [one, "DELETE"],
    ];
    for (const [src, name] of cases) {
      const fn = handlerBody(src, name);
      expect(fn, `${name} is missing`).not.toBe("");
      const guard = fn.indexOf("requirePartnerRight");
      const service = fn.indexOf("serviceClient(");
      expect(guard, `${name} has no right check`).toBeGreaterThan(-1);
      expect(guard, `${name} builds the service client first`).toBeLessThan(service);
    }
  });

  it("gates each verb on its own right", () => {
    expect(handlerBody(list, "GET")).toContain('requirePartnerRight("view_proposals")');
    expect(handlerBody(list, "POST")).toContain('requirePartnerRight("create_proposals")');
    expect(handlerBody(one, "GET")).toContain('requirePartnerRight("view_proposals")');
    expect(handlerBody(one, "PATCH")).toContain('requirePartnerRight("edit_proposals")');
    expect(handlerBody(one, "DELETE")).toContain('requirePartnerRight("delete_proposals")');
  });

  it("keeps no trace of the founder-email gate", () => {
    for (const src of [list, one]) {
      expect(src).not.toContain("requireFounder");
      expect(src).not.toContain("lib/auth/superadmin");
      expect(src).not.toContain("toErrorResponse");
    }
  });

  it("bounds the list query, because PostgREST caps silently at 1000", () => {
    expect(list).toMatch(/\.(range|limit)\(/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /c/Wacrm/ozzo-partner && npx vitest run app/api/proposals/route-shape.test.ts
```

Expected: FAIL — `ENOENT` on `app/api/proposals/route.ts`. That is the right failure: the guard is real before the code is.

- [ ] **Step 3: Copy the two routes and apply the three mechanical edits**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/api/proposals/[id]"
cp wacrm-web/src/app/api/admin/proposals/route.ts        ozzo-partner/app/api/proposals/route.ts
cp "wacrm-web/src/app/api/admin/proposals/[id]/route.ts" "ozzo-partner/app/api/proposals/[id]/route.ts"
```

Then in both files: swap the imports and gate per "The three mechanical edits", delete the `try/catch` + `toErrorResponse` wrappers, and add `.range(0, 999)` plus an ordering to the list query if it has neither. Keep every other line, including the comments — they explain `denormalise()` and the ref-number retry, and both still apply.

Replace the CRM's header comment with one that says where the protection now comes from:

```ts
// ============================================================
// OZZO's own sales proposals. Moved here from /api/admin/proposals in
// Phase 3; the rows are the same rows.
//
// platform_proposals has RLS enabled and NO policies, by design — a policy
// here would expose OZZO's quoted prices to every signed-in tenant user. So
// the service-role client is the only way in, and requirePartnerRight() on
// the caller's own session is the only thing deciding who gets through.
// Right first, service client second. route-shape.test.ts pins it.
// ============================================================
```

- [ ] **Step 4: Run the guard test and the typecheck**

```bash
cd /c/Wacrm/ozzo-partner && npx vitest run app/api/proposals/route-shape.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): proposals API, gated on partner rights

Moved from wacrm-web /api/admin/proposals. Same table, same response
shapes, requireFounder() replaced by requirePartnerRight() per verb.

route-shape.test.ts was written and seen to fail first: platform_proposals
has RLS on with no policies, so the service client sees everything and the
ORDER of the right check is the access control.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The proposals screens and the proposal PDF

**Files:**
- Create: `app/(portal)/proposals/page.tsx`, `proposals-client.tsx`
- Create: `app/(portal)/proposals/[id]/page.tsx`, `proposal-detail.tsx`
- Create: `app/(portal)/proposals/[id]/edit/page.tsx`, `proposal-form.tsx`
- Create: `app/print/proposal/[id]/page.tsx`, `download-button.tsx`
- Modify: `lib/nav.ts` — Proposals `built: true`

**Interfaces:**
- Consumes: Task 2's routes; `DataTable`, `ColumnDef` (`@/components/ui/data-table/*`), `useTableView` (`@/hooks/use-table-view`), `matchesColumnFilters` (`@/lib/table/match-filters`), `PageLayout` (`@/components/shared`) — all already present in this app and copied from the same CRM commit, so they take the CRM's props unchanged.
- Produces: the `/proposals` routes the Calculator (Task 4) and Forecast (Task 5) link to.

- [ ] **Step 1: Copy the six screen files**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/(portal)/proposals/[id]/edit" "ozzo-partner/app/print/proposal/[id]"
SRC="wacrm-web/src/app/(superadmin)/admin/proposals"
DST="ozzo-partner/app/(portal)/proposals"
cp "$SRC/page.tsx" "$DST/page.tsx"
cp "$SRC/proposals-client.tsx" "$DST/proposals-client.tsx"
cp "$SRC/[id]/page.tsx" "$DST/[id]/page.tsx"
cp "$SRC/[id]/proposal-detail.tsx" "$DST/[id]/proposal-detail.tsx"
cp "$SRC/[id]/edit/page.tsx" "$DST/[id]/edit/page.tsx"
cp "$SRC/[id]/edit/proposal-form.tsx" "$DST/[id]/edit/proposal-form.tsx"
cp "wacrm-web/src/app/print/proposal/[id]/page.tsx"            "ozzo-partner/app/print/proposal/[id]/page.tsx"
cp "wacrm-web/src/app/print/proposal/[id]/download-button.tsx" "ozzo-partner/app/print/proposal/[id]/download-button.tsx"
```

- [ ] **Step 2: Apply the three mechanical edits across all eight files**

Find every path and gate to change:

```bash
cd /c/Wacrm/ozzo-partner && grep -rn "admin/proposals\|api/admin\|requireFounder\|lib/auth/superadmin" "app/(portal)/proposals" "app/print/proposal"
```

Change each one per the tables above. The print page's gate becomes `requirePartnerRight("view_proposals")` and its `try { } catch { return null }` stays — returning `null` so the page can call `notFound()` itself is the right behaviour for a print URL someone pasted.

- [ ] **Step 3: Flip the nav flag**

In `lib/nav.ts`, the Proposals row only: `built: false` → `built: true`. Leave the others for their own tasks — `nav.test.ts` walks the route folder and fails if a flag and a page disagree in either direction, which is exactly the guard wanted here.

- [ ] **Step 4: Typecheck, test, build**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

Expected: all clean. `nav.test.ts` passing is the proof the flag and the folder agree.

- [ ] **Step 5: Click it through**

```bash
cd /c/Wacrm/ozzo-partner && npm run dev
```

Sign in at `http://localhost:3300` as the founder and check, in this order:

1. `/proposals` lists the real proposals, newest first, with the filter row and Manage Columns working.
2. Open one. The detail page shows its totals and its plan.
3. Edit it, change the client name, save, and see the change in the list.
4. `Print` opens `/print/proposal/<id>` with no sidebar, the cover page renders its background, and "Download PDF" opens the browser's print dialog at A4.
5. Create a proposal from the list, if the list has a New button.

Record what was checked. "It compiles" and "I opened it" are different claims.

- [ ] **Step 6: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Sales Proposals screens and the A4 proposal PDF

Copied from wacrm-web /admin/proposals with the three mechanical edits
only: the gate, the paths, the right keys. The print route moves too —
leaving it behind would break PDF output, which is the whole point of
the module.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Price Calculator

**Files:**
- Create: `app/(portal)/calculator/page.tsx`, `calculator-client.tsx`, `term-cards.tsx`, `term-cards.test.tsx`, `quotable-plans.ts`, `quotable-plans.test.ts`
- Modify: `lib/nav.ts` — Price Calculator `built: true`

**Interfaces:**
- Consumes: `PLAN_PRICE`, `planOptions` (`@/lib/plans/catalog`), `quoteFor` (`@/lib/plans/pricing`), `inr` (`@/lib/proposals/format`), `POST /api/proposals` (Task 2).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Copy the six files**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/(portal)/calculator"
for f in page.tsx calculator-client.tsx term-cards.tsx term-cards.test.tsx quotable-plans.ts quotable-plans.test.ts; do
  cp "wacrm-web/src/app/(superadmin)/admin/calculator/$f" "ozzo-partner/app/(portal)/calculator/$f"
done
```

- [ ] **Step 2: Apply the mechanical edits, and the one that is not mechanical**

Gate the page on `view_calculator`. Then fix coupling B: the page must tell the client whether this person may create a proposal.

`app/(portal)/calculator/page.tsx`:

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { can } from "@/lib/auth/rights";
import CalculatorClient from "./calculator-client";

// The price calculator. Pure arithmetic over lib/plans — it reads no table.
//
// "Save as proposal" is a SECOND right. view_calculator lets a salesperson
// quote a price; create_proposals lets them commit one to the record, and the
// seeded Sales Executive role holds the first and not the second. The button
// is hidden here and POST /api/proposals refuses it anyway; neither alone is
// enough, because a hidden button is not access control and a 404 from a
// button that should not have been there reads as a bug.
export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  const me = await requirePartnerRight("view_calculator");
  return (
    <CalculatorClient
      canCreateProposal={can(me.permissions, "create_proposals")}
      canViewProposals={can(me.permissions, "view_proposals")}
    />
  );
}
```

In `calculator-client.tsx`:

```tsx
export default function CalculatorClient({
  canCreateProposal,
  canViewProposals,
}: {
  canCreateProposal: boolean;
  canViewProposals: boolean;
}) {
```

Then: wrap the "Save as proposal" button in `{canCreateProposal ? … : null}`; wrap the "All proposals" button in `{canViewProposals ? … : null}`; change the POST target to `/api/proposals`, the redirect to `router.push(`/proposals/${payload.id}/edit`)`, and the list link to `router.push("/proposals")`. Both flags are needed, and they are different questions: one is whether this person may write a proposal, the other whether they may look at the list. A Telecaller holds neither and still gets the calculator.

- [ ] **Step 3: Flip the nav flag, then typecheck, test, build**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

Expected: `term-cards.test.tsx` and `quotable-plans.test.ts` pass unchanged in their new home.

- [ ] **Step 4: Click it through**

At `/calculator`: pick a plan, set users, confirm the three term cards show yearly base, half-yearly +20% and quarterly +40% (the founder's own rule, `billing-terms-and-price-calculator`), then "Save as proposal" and confirm it lands on the new proposal's edit page.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Price Calculator

Copied from /admin/calculator. One change beyond the mechanical edits:
saving a quote as a proposal is gated on create_proposals, not on
view_calculator, because the seeded Sales Executive role holds the
second and not the first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Business Forecast, loaded on the server

**Files:**
- Create: `app/(portal)/forecast/page.tsx`, `forecast-client.tsx`
- Modify: `lib/nav.ts` — Business Forecast `built: true`

**Interfaces:**
- Consumes: `summarise`, `type ForecastRow`, `type ForecastBasis`, `BASIS_LABEL`, `FORECAST_BASES`, `MIN_DECIDED_FOR_WIN_RATE` (`@/lib/proposals/forecast`), `inr` (`@/lib/proposals/format`), `chartTooltipProps` (`@/components/charts/chart-tooltip`), recharts.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Copy both files**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/(portal)/forecast"
cp "wacrm-web/src/app/(superadmin)/admin/forecast/page.tsx"            "ozzo-partner/app/(portal)/forecast/page.tsx"
cp "wacrm-web/src/app/(superadmin)/admin/forecast/forecast-client.tsx" "ozzo-partner/app/(portal)/forecast/forecast-client.tsx"
```

- [ ] **Step 2: Rewrite the page as a server component that loads the rows**

This is coupling A. Replace `app/(portal)/forecast/page.tsx` entirely:

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { serviceClient } from "@/lib/auth/partner-service";
import type { ForecastRow } from "@/lib/proposals/forecast";
import ForecastClient from "./forecast-client";

// Business forecasting over OZZO's own proposals.
//
// The CRM's version fetched /api/admin/proposals from the browser. Ported
// as-is, somebody holding view_forecast and not view_proposals would get a
// 404 from that fetch and an empty chart with nothing to explain it — two
// rights gating one screen. So the rows are loaded here, behind the one
// right this screen is about, and handed down. One round trip instead of two,
// and the chart is populated on first paint.
//
// Right first, service client second: platform_proposals has RLS on with no
// policies at all.
export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  await requirePartnerRight("view_forecast");

  // Bounded explicitly. PostgREST caps a result at 1,000 rows without saying
  // so, and a forecast built from a silently truncated list is worse than no
  // forecast. If OZZO ever writes more than 5,000 proposals, this needs
  // paging rather than a bigger number.
  const { data } = await serviceClient()
    .from("platform_proposals")
    .select("id, ref, client_name, plan, proposal_date, grand_total, data")
    .order("proposal_date", { ascending: false })
    .range(0, 4999);

  return <ForecastClient rows={(data as ForecastRow[] | null) ?? []} />;
}
```

Check the `select` list against `type ForecastRow` in `lib/proposals/forecast.ts` and against what `summarise()` actually reads — the status and the won date live inside `data` in the CRM's shape, and this query must carry every field `summarise()` touches. If `ForecastRow` names a column this select omits, add it; do not widen to `select("*")`, which would ship the whole proposal JSON to the browser.

- [ ] **Step 3: Make the client take rows as a prop**

In `forecast-client.tsx`: delete the `useEffect` fetch, the `loading` state and the `err` state; take `{ rows }: { rows: ForecastRow[] }`; keep everything else, including the `useMemo` over `summarise`. Change the "All proposals" button to `/proposals` — and, since this screen may be held by someone without `view_proposals`, drop that back-link rather than render a link to a 404. Replace it with the page's own heading.

- [ ] **Step 4: Typecheck, test, build**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

The build is the step that matters here: recharts in a server-rendered tree is the usual place a chart module explodes, and `"use client"` at the top of `forecast-client.tsx` is what prevents it. Confirm that line survived the copy.

- [ ] **Step 5: Click it through**

At `/forecast`: the monthly bar chart has bars, the renewals chart has bars, switching the basis (yearly / half-yearly / quarterly / monthly) changes the numbers, and hovering a bar shows the tooltip with a readable background in both light and dark mode — that tooltip exists because the shared one was invisible, so look at it in both.

- [ ] **Step 6: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Business Forecast, loaded on the server

Copied from /admin/forecast, with one deliberate change: the page loads
the proposals itself behind view_forecast instead of the browser fetching
/api/proposals. Ported as-is, view_forecast without view_proposals gave a
404 and an empty chart — two rights gating one screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The invoices API

**Files:**
- Create: `app/api/invoices/route.ts`, `app/api/invoices/[id]/route.ts`, `app/api/invoices/route-shape.test.ts`

**Interfaces:**
- Consumes: `requirePartnerRight`, `serviceClient`, `type InvoiceRow` (`@/lib/invoices/types`), `invoiceTotals` (`@/lib/invoices/totals`), `nextInvoiceNo` (`@/lib/invoices/number`), `denormalise` (`@/lib/invoices/denormalise`), `todayInIndia` (`@/lib/proposals/today`).
- Produces: `GET|POST /api/invoices`, `GET|PATCH /api/invoices/[id]` with the CRM's response envelopes unchanged.

- [ ] **Step 1: Write the guard test first and watch it fail**

Copy `app/api/proposals/route-shape.test.ts` to `app/api/invoices/route-shape.test.ts` and change: the two paths, the handler list (`GET`, `POST` on the list; `GET`, `PATCH` on `[id]` — there is **no DELETE**, because an issued invoice is a legal document and the CRM never offered one), and the right keys to `view_invoices` / `create_invoices` / `edit_invoices`. Add:

```ts
it("offers no way to delete an invoice", () => {
  // An issued invoice is a legal document. The CRM never had a DELETE here
  // and neither does this. Cancelling is a status, handled by PATCH.
  expect(handlerBody(list, "DELETE")).toBe("");
  expect(handlerBody(one, "DELETE")).toBe("");
});

it("keeps the invoice-number retry, which is what makes numbering safe", () => {
  // nextInvoiceNo + a unique index + retry on 23505. Two invoices created in
  // the same second must not share a number, and a transaction would not
  // help because the number is derived, not sequential.
  expect(list).toContain("nextInvoiceNo");
  expect(list).toContain("23505");
});
```

```bash
cd /c/Wacrm/ozzo-partner && npx vitest run app/api/invoices/route-shape.test.ts
```

Expected: FAIL, `ENOENT`.

- [ ] **Step 2: Copy the two routes and apply the mechanical edits**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/api/invoices/[id]"
cp wacrm-web/src/app/api/admin/invoices/route.ts        ozzo-partner/app/api/invoices/route.ts
cp "wacrm-web/src/app/api/admin/invoices/[id]/route.ts" "ozzo-partner/app/api/invoices/[id]/route.ts"
```

Apply the three edits. If the guard test's `23505` assertion fails after the copy, the retry is genuinely missing from the source — read `lib/invoices/number.ts` and port the retry rather than deleting the assertion.

- [ ] **Step 3: Run the guard test and the typecheck**

```bash
cd /c/Wacrm/ozzo-partner && npx vitest run app/api/invoices/route-shape.test.ts && npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): invoices API, gated on partner rights

Moved from /api/admin/invoices. No DELETE, by design: an issued invoice
is a legal document and cancelling is a status. The guard test also pins
the 23505 retry that keeps two same-second invoices from sharing a number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The invoices screens and the invoice PDF

**Files:**
- Create: `app/(portal)/invoices/page.tsx`, `invoices-client.tsx`, `invoice-form.tsx`, `status-badge.tsx`
- Create: `app/(portal)/invoices/new/page.tsx`
- Create: `app/(portal)/invoices/[id]/page.tsx`, `invoice-detail.tsx`, `[id]/edit/page.tsx`
- Create: `app/print/invoice/[id]/page.tsx`, `download-button.tsx`
- Modify: `lib/nav.ts` — Invoices `built: true`

**Interfaces:**
- Consumes: Task 6's routes, Task 1's `InvoiceDocument` and `lib/gst/states`, the table framework.
- Produces: `/invoices` — linked from the customer billing panel in Task 10.

- [ ] **Step 1: Copy the nine files**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/(portal)/invoices/new" "ozzo-partner/app/(portal)/invoices/[id]/edit" "ozzo-partner/app/print/invoice/[id]"
SRC="wacrm-web/src/app/(superadmin)/admin/invoices"
DST="ozzo-partner/app/(portal)/invoices"
for f in page.tsx invoices-client.tsx invoice-form.tsx status-badge.tsx; do cp "$SRC/$f" "$DST/$f"; done
cp "$SRC/new/page.tsx"          "$DST/new/page.tsx"
cp "$SRC/[id]/page.tsx"         "$DST/[id]/page.tsx"
cp "$SRC/[id]/invoice-detail.tsx" "$DST/[id]/invoice-detail.tsx"
cp "$SRC/[id]/edit/page.tsx"    "$DST/[id]/edit/page.tsx"
cp "wacrm-web/src/app/print/invoice/[id]/page.tsx"            "ozzo-partner/app/print/invoice/[id]/page.tsx"
cp "wacrm-web/src/app/print/invoice/[id]/download-button.tsx" "ozzo-partner/app/print/invoice/[id]/download-button.tsx"
```

- [ ] **Step 2: Apply the mechanical edits**

```bash
cd /c/Wacrm/ozzo-partner && grep -rn "admin/invoices\|admin/proposals\|api/admin\|requireFounder\|lib/auth/superadmin" "app/(portal)/invoices" "app/print/invoice"
```

Note `invoices/new/page.tsx` reads `platform_proposals` **directly** with the service client to prefill an invoice from a proposal — that is a table read, not a call to the proposals API, so it ports unchanged apart from the gate. Gate it on `create_invoices`; a person who may create an invoice may prefill it from a proposal, and the prefill reveals only the figures that are about to appear on the invoice anyway.

- [ ] **Step 3: Flip the nav flag, then typecheck, test, build**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

- [ ] **Step 4: Click it through — and check the arithmetic, not just the render**

At `/invoices`:

1. The list shows every existing invoice with its number, date, total and status.
2. Open one: the line items, the tax split and the total match what `/admin/invoices` showed for the same invoice before this push. **Compare against a screenshot or a note taken before the deletion in Task 11** — this is the only assertion that the copy preserved the money.
3. `New` → prefill from a proposal → the figures carry over.
4. Save a new invoice and confirm the number follows the existing series, in the right financial year (`lib/invoices/fy.ts`).
5. Edit an invoice, change a line, and confirm the total recomputes.
6. Print: `/print/invoice/<id>`, black on white, A4, seller details from invoice settings.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Invoices screens and the A4 invoice PDF

Copied from /admin/invoices. invoices/new reads platform_proposals
directly for its prefill, which is a table read and ports unchanged
behind create_invoices.

Verified against the live rows: an invoice's line items, tax split and
total read the same here as they did in /admin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Invoice Settings, inside the portal's own Settings

**Files:**
- Create: `app/api/invoice-settings/route.ts`, `app/api/invoice-settings/route-shape.test.ts`
- Create: `app/(portal)/settings/invoice/page.tsx`, `settings-form.tsx`
- Modify: `app/(portal)/settings/settings-client.tsx` — a gated link through

**Interfaces:**
- Consumes: `requirePartnerRight("manage_invoice_settings")`, `serviceClient`, `Switch` (`@/components/ui/switch`), `GST_STATES` (`@/lib/gst/states`).
- Produces: the numbering prefix, GST registration and seller branding that Task 7's invoice form and the invoice PDF read.

- [ ] **Step 1: Write the guard test and watch it fail**

`app/api/invoice-settings/route-shape.test.ts`, same shape as before, asserting both handlers call `requirePartnerRight("manage_invoice_settings")` before `serviceClient(`, and:

```ts
it("gates reading as well as writing", () => {
  // The seller's GST number, address and bank details are on this row.
  // There is no "view" right for it — one right covers both, which is what
  // the spec's registry says: invoices get view_/create_/edit_ plus
  // manage_invoice_settings, and nothing finer.
  expect(handlerBody(src, "GET")).toContain('requirePartnerRight("manage_invoice_settings")');
});
```

- [ ] **Step 2: Copy the route and the screen**

```bash
cd /c/Wacrm
mkdir -p ozzo-partner/app/api/invoice-settings "ozzo-partner/app/(portal)/settings/invoice"
cp wacrm-web/src/app/api/admin/invoice-settings/route.ts "ozzo-partner/app/api/invoice-settings/route.ts"
cp "wacrm-web/src/app/(superadmin)/admin/invoice-settings/page.tsx"         "ozzo-partner/app/(portal)/settings/invoice/page.tsx"
cp "wacrm-web/src/app/(superadmin)/admin/invoice-settings/settings-form.tsx" "ozzo-partner/app/(portal)/settings/invoice/settings-form.tsx"
```

Apply the mechanical edits. `settings-form.tsx` links back to `/admin/invoices`; that becomes `/invoices`.

- [ ] **Step 3: Add the way in**

Invoice Settings sits at `/settings/invoice`, not in the sidebar — it is settings, and this app already has a Settings screen holding four master lists. Add a card or row to `app/(portal)/settings/settings-client.tsx` linking to it, rendered only when `can(permissions, "manage_invoice_settings")`. Read the existing file first and follow whatever pattern the four master lists use; do not invent a second layout language inside one screen.

Because `lib/nav.ts` has no row for this page, check `nav.test.ts` still passes — it walks the route folder, and a new folder under an existing nav route must not trip it. If it does, the test needs a note explaining that `/settings/invoice` is a sub-page of Settings rather than a nav item of its own.

- [ ] **Step 4: Typecheck, test, build, click**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

Then at `/settings`: the Invoice Settings link appears for the founder; open it, confirm the existing numbering prefix, GST registration and seller details are the live ones; change the seller phone, save, reload, and see it stick; open an invoice PDF and see the new phone on it.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Invoice Settings at /settings/invoice

Moved from /admin/invoice-settings into this app's own Settings screen
rather than the sidebar, where it belongs. One right, manage_invoice_settings,
covers reading and writing: the seller's GST number and bank details are
on that row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Renewals

**Files:**
- Create: `app/api/renewals/route.ts`, `[id]/route.ts`, `[id]/renew/route.ts`, `route-shape.test.ts`
- Create: `app/(portal)/renewals/page.tsx`, `renewals-client.tsx`, `renew-dialog.tsx`, `subscription-form.tsx`
- Modify: `lib/nav.ts` — Renewals `built: true`

**Interfaces:**
- Consumes: `requirePartnerRight`, `serviceClient`, `bucketFor` (`@/lib/renewals/buckets`), `nextPeriod` (`@/lib/renewals/next-period`), `type SubscriptionRow` (`@/lib/renewals/types`).
- Produces: `/renewals`, and the renew action the customer billing panel's renewal date reflects.

- [ ] **Step 1: Write the guard test and watch it fail**

Three route files this time. Assert the right before the service client in every handler, and the keys: `view_renewals` on both `GET`s, `renew_subscription` on `POST /api/renewals`, `PATCH /api/renewals/[id]` and `POST /api/renewals/[id]/renew`. Add:

```ts
it("keys subscriptions on customer_id, not account_id", () => {
  // platform_subscriptions has NO account_id. It keys on the TEXT Customer ID
  // (e.g. "001288") that also lives on accounts.customer_id. Reading it by
  // account id returns nothing, quietly — which is how this was got wrong
  // once already in app/api/customers/billing/route.ts.
  expect(list).toContain("customer_id");
  expect(list).not.toMatch(/platform_subscriptions[\s\S]{0,120}eq\("account_id"/);
});
```

- [ ] **Step 2: Copy the seven files and apply the mechanical edits**

```bash
cd /c/Wacrm
mkdir -p "ozzo-partner/app/api/renewals/[id]/renew" "ozzo-partner/app/(portal)/renewals"
cp wacrm-web/src/app/api/admin/renewals/route.ts                  ozzo-partner/app/api/renewals/route.ts
cp "wacrm-web/src/app/api/admin/renewals/[id]/route.ts"           "ozzo-partner/app/api/renewals/[id]/route.ts"
cp "wacrm-web/src/app/api/admin/renewals/[id]/renew/route.ts"     "ozzo-partner/app/api/renewals/[id]/renew/route.ts"
SRC="wacrm-web/src/app/(superadmin)/admin/renewals"
for f in page.tsx renewals-client.tsx renew-dialog.tsx subscription-form.tsx; do
  cp "$SRC/$f" "ozzo-partner/app/(portal)/renewals/$f"
done
```

- [ ] **Step 3: Flip the nav flag, then typecheck, test, build**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

- [ ] **Step 4: Click it through**

At `/renewals`: the buckets (overdue, due in 30 days, later) hold the same subscriptions `/admin/renewals` showed; open the renew dialog on a subscription whose end date is known, renew it for one term, and confirm the new end date is exactly what `nextPeriod()` says — one year on from the old end date, not from today. Then open that customer's record in `/customers` and confirm the renewal date shown there changed too, since the billing panel reads the same row.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner && git add -A && git commit -m "feat(partner): Renewals

Moved from /admin/renewals. The guard test also pins that subscriptions
are keyed on the TEXT customer_id and never on account_id — that table
has no account_id, and reading it by one returns nothing quietly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Give a proposal an account, and show proposals on the customer

The one schema change in this push, and the one the shipped code already promises. `app/api/customers/billing/route.ts` says, in Phase 2B's own comment:

> `platform_proposals` has NO link to an account at all — only a free-text `client_name`. It is therefore NOT shown here. Matching a proposal to a customer by name would attach the wrong proposal to the wrong business the first time two clients have similar names … Proposals get a real account link in Phase 3, when that module moves across; this panel picks them up then.

**Files:**
- Create: `wacrm-web/supabase/migrations/20261125120000_platform_proposals_account.sql`
- Modify: an existing `wacrm-web/supabase/tests/*.sql` scenario, and `scripts/run-db-tests.sh` only if a new file is added
- Modify: `ozzo-partner/app/api/customers/billing/route.ts`, the customer detail billing panel, `app/api/proposals/route.ts` and `[id]/route.ts` (accept `account_id`), the proposal form (an account picker)
- Create: `ozzo-partner/app/api/customers/billing/route-shape.test.ts` additions

**Interfaces:**
- Produces: `platform_proposals.account_id uuid null references public.accounts(id) on delete set null`; `GET /api/customers/billing` gains `proposals: {...}[]` and `allowed.proposals`.

- [ ] **Step 1: Write the migration, with the five questions answered in its own comments**

```sql
-- ============================================================
-- platform_proposals.account_id — the real link a proposal has lacked.
--
-- Phase 2B's customers billing panel shows a customer's invoices and their
-- renewal, and deliberately not their proposals, because the only thing
-- joining a proposal to a business was free-text client_name. Matching on a
-- name attaches the wrong proposal to the wrong business the first time two
-- clients are called something similar, and a wrong figure on a customer's
-- page is worse than no figure.
--
-- THE FIVE QUESTIONS
--
-- 1. What breaks if this runs twice?
--    Nothing. add column if not exists, create index if not exists.
--
-- 2. What else reads these columns, in EITHER repo and in supabase/tests?
--    platform_proposals is selected in:
--      ozzo-partner/app/api/proposals/route.ts and [id]/route.ts
--      ozzo-partner/app/(portal)/invoices/new/page.tsx  (prefill)
--      ozzo-partner/app/(portal)/forecast/page.tsx
--    All name their columns explicitly, so a new nullable column changes no
--    existing result. Grep both repos before applying:
--      grep -rn "platform_proposals" /c/Wacrm/wacrm-web /c/Wacrm/ozzo-partner
--
-- 3. What happens to rows that already exist?
--    account_id is NULL on all of them. A proposal with no account simply
--    does not appear on any customer's page, which is today's behaviour
--    exactly. Nothing is backfilled by name — see above for why.
--
-- 4. Which policy decides who may read the new rows?
--    None, and that is correct. platform_proposals has RLS enabled with no
--    policies; every read goes through a server route that has already
--    called requirePartnerRight(). This migration adds no policy.
--
-- 5. How is it undone?
--    alter table public.platform_proposals drop column account_id;
--    (The index goes with the column.)
--
-- SECOND-FK CHECK: platform_proposals' only existing foreign key is
-- created_by -> auth.users. This is its FIRST key to public.accounts, so no
-- PostgREST embed becomes ambiguous. Anything wanting a second route from a
-- proposal to an account later must use a plain uuid with no constraint.
-- See orders-second-fk-broke-every-order.
-- ============================================================

alter table public.platform_proposals
  add column if not exists account_id uuid
    references public.accounts(id) on delete set null;

comment on column public.platform_proposals.account_id is
  'The real OZZO account this proposal is for, once known. NULL until someone '
  'links it; never inferred from client_name.';

create index if not exists platform_proposals_account_idx
  on public.platform_proposals (account_id)
  where account_id is not null;
```

- [ ] **Step 2: Add a scenario, and add it to the runner's hard-coded list**

Create `supabase/tests/86_partner_proposal_account.sql`. Every assertion must be a **top-level `SELECT qa(` call** — the runner counts those to detect a file that aborted half way, and a bare `select … as something` is not counted and not recorded.

```sql
-- ============================================================
-- 86 — platform_proposals.account_id
--
-- Three things worth asserting, and one of them is about orders, not
-- proposals: that this is the FIRST foreign key from platform_proposals to
-- public.accounts. A second one breaks the PostgREST embed for every row of
-- the table, which is how every order screen was dead for three days.
-- ============================================================

INSERT INTO public.accounts (id, name, customer_id)
VALUES ('aaaaaaaa-0000-4000-8000-000000000086', 'QA86 Account', '990086')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_proposals (id, ref, client_name, account_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000086', 'QA86-001', 'QA86 Client',
        'aaaaaaaa-0000-4000-8000-000000000086')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_proposals (id, ref, client_name)
VALUES ('bbbbbbbb-0000-4000-8000-000000000087', 'QA86-002', 'QA86 Unlinked')
ON CONFLICT (id) DO NOTHING;

SELECT qa('P86a a proposal may carry an account, and may carry none',
  (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbbbbbb-0000-4000-8000-000000000086') IS NOT NULL
  AND (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbbbbbb-0000-4000-8000-000000000087') IS NULL,
  'the column is nullable and every existing row stays NULL');

DELETE FROM public.accounts WHERE id = 'aaaaaaaa-0000-4000-8000-000000000086';

SELECT qa('P86b deleting the account keeps the proposal and clears its link',
  (SELECT count(*) FROM public.platform_proposals
     WHERE id = 'bbbbbbbb-0000-4000-8000-000000000086') = 1
  AND (SELECT account_id FROM public.platform_proposals
     WHERE id = 'bbbbbbbb-0000-4000-8000-000000000086') IS NULL,
  'on delete set null, not cascade — a closed account must not erase the deal');

SELECT qa('P86c exactly ONE foreign key from platform_proposals to accounts',
  (SELECT count(*) FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_class f ON f.oid = c.confrelid
    WHERE c.contype = 'f' AND t.relname = 'platform_proposals'
      AND f.relname = 'accounts') = 1,
  'a second one makes every PostgREST embed on this table ambiguous');
```

Then add it to the hard-coded list in `scripts/run-db-tests.sh` (around line 101), immediately after `85_partner_convert_and_territories`:

```
for f in 00_fixture … 85_partner_convert_and_territories 86_partner_proposal_account; do
```

That list is **not** a glob. A file left out of it never runs, and the suite still prints `All scenarios passed.`

- [ ] **Step 3: Run the harness and read the table, not the exit code**

```bash
cd /c/Wacrm/wacrm-web && PGPORT=54437 PGDATA_DIR="$TMPDIR/pgtest-p3" bash scripts/run-db-tests.sh
```

Expected: the `passed | failed` table shows the new assertions passing and `All scenarios passed.` The ~47 migration errors on the way up are pre-existing.

- [ ] **Step 4: Accept and set the account on a proposal**

In `app/api/proposals/route.ts` (POST) and `[id]/route.ts` (PATCH), accept `account_id` — `null` when absent, never a string `"null"`. In the proposal form, add an account picker using the same component the customer form uses to link an account (read `app/(portal)/customers/customer-form.tsx` and `app/api/customers/accounts/route.ts` and reuse them; a second account picker with different behaviour in one app is a defect waiting to happen).

- [ ] **Step 5: Show them on the customer**

In `app/api/customers/billing/route.ts`: add `proposals: can(me.permissions, "view_proposals")` to `allowed`, and when allowed and an account id has been earned, fetch the five most recent proposals for that `account_id`. Keep the existing order of operations exactly — the account id is earned on the caller's own session first, then the service client. Replace the long comment about proposals having no link with one saying they now do, and that NULL means unlinked rather than none.

Then render them in the customer detail billing panel beside the invoices, each linking to `/proposals/<id>`.

- [ ] **Step 6: Five gates in both repos, then click it**

```bash
cd /c/Wacrm/ozzo-partner && npx tsc --noEmit && npx vitest run && npx next build
```

Then: open a proposal, link it to an account, open that account's customer record, and see the proposal listed. Open a customer whose account has no proposals and confirm the panel says so rather than showing an empty table.

- [ ] **Step 7: Commit both repos, and write the SQL file the founder pastes**

The migration cannot be applied from here — the Supabase CLI is linked to the stale Singapore project, so Mumbai changes are pasted by hand. Write `wacrm-web/docs/RUN-THIS-SQL-partner-phase-3.md` containing the migration verbatim, with a one-paragraph plain-English preface saying what it does and that it changes nothing that already exists.

```bash
cd /c/Wacrm/wacrm-web && git add -A && git commit -m "feat(partner): platform_proposals.account_id

The real link a proposal has lacked. Phase 2B's billing panel refused to
show proposals because the only join was free-text client_name; this adds
the column it was waiting for. Nullable, nothing backfilled by name, and
the first FK from proposals to accounts so no embed becomes ambiguous.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Delete the six from `/admin`, and close the push

Removal is part of this push, not a later tidy-up. Two homes for one invoice list is the thing decision 3 exists to prevent.

**Files:**
- Delete: `wacrm-web/src/app/(superadmin)/admin/{proposals,invoices,invoice-settings,renewals,calculator,forecast}/**`
- Delete: `wacrm-web/src/app/api/admin/{proposals,invoices,invoice-settings,renewals}/**`
- Delete: `wacrm-web/src/app/print/{proposal,invoice}/**`
- Modify: `wacrm-web/src/app/(superadmin)/admin/admin-shell.tsx` — remove the six nav rows

- [ ] **Step 1: Before deleting anything, take the comparison notes Task 7 step 4 needs**

If they were not taken then, take them now: open `/admin/invoices` and one invoice, `/admin/renewals`, `/admin/proposals` and one proposal, and record the totals. Once these routes are gone there is nothing to compare against.

- [ ] **Step 2: Prove nothing else in `wacrm-web` points at them**

```bash
cd /c/Wacrm/wacrm-web/src && grep -rn "admin/proposals\|admin/invoices\|admin/renewals\|admin/invoice-settings\|admin/calculator\|admin/forecast\|print/proposal\|print/invoice" --include=*.ts --include=*.tsx . | grep -v "^./app/(superadmin)/admin/\(proposals\|invoices\|invoice-settings\|renewals\|calculator\|forecast\)/" | grep -v "^./app/api/admin/\(proposals\|invoices\|invoice-settings\|renewals\)/" | grep -v "^./app/print/\(proposal\|invoice\)/"
```

Expected after the deletions: only `admin-shell.tsx` (fixed in step 4) and the comment in `lib/invoices/denormalise.ts`, which may stay — `lib/invoices` remains in `wacrm-web` because other things read it. **If anything else appears, stop and fix it before deleting.** This grep is the only thing standing between this push and a 404 inside `/admin`.

- [ ] **Step 3: Delete**

```bash
cd /c/Wacrm/wacrm-web/src
rm -rf "app/(superadmin)/admin/proposals" "app/(superadmin)/admin/invoices" \
       "app/(superadmin)/admin/invoice-settings" "app/(superadmin)/admin/renewals" \
       "app/(superadmin)/admin/calculator" "app/(superadmin)/admin/forecast" \
       app/api/admin/proposals app/api/admin/invoices \
       app/api/admin/invoice-settings app/api/admin/renewals \
       app/print/proposal app/print/invoice
```

`src/lib/invoices`, `src/lib/proposals`, `src/lib/renewals` and `src/lib/plans` stay in `wacrm-web`: `lib/plans` gates the whole product, and the other three are now copied rather than shared, which is the accepted cost of decision 1.

- [ ] **Step 4: Remove the six nav rows**

In `src/app/(superadmin)/admin/admin-shell.tsx`, delete the rows for Invoices, Renewals, Sales Proposals, Price Calculator and Business Forecast (and Invoice Settings if it has a row), and any now-unused `lucide-react` imports. Add one comment above the remaining list:

```tsx
// OZZO's own sales modules — proposals, invoices, invoice settings, renewals,
// the price calculator and the forecast — moved to partner.ozzo.co.in in
// Phase 3. They were never tenant operations; isFounderEmail hiding them was
// the tell. Data Retention stays: that one is platform housekeeping.
```

- [ ] **Step 5: Five gates in `wacrm-web`**

```bash
cd /c/Wacrm/wacrm-web && npx tsc --noEmit && npx vitest run && npm run lint:ui && npx next build
```

`npx vitest run` will fail if `app/api/admin/proposals/route.test.ts` was deleted while something still imported it — that test file goes with its route. Expected: all clean.

Then run the app and click `/admin`: the sidebar no longer lists the six, `/admin/invoices` 404s, and every remaining `/admin` screen still loads — especially Companies and Billing, which are next to the deleted ones in the shell.

- [ ] **Step 6: Commit the deletion**

```bash
cd /c/Wacrm/wacrm-web && git add -A && git commit -m "refactor(admin): remove the six sales modules, now at partner.ozzo.co.in

Proposals, invoices, invoice settings, renewals, the price calculator and
the business forecast, with both print routes and the four API trees.
Removal is part of the same push as the move: two homes for one invoice
list is what spec decision 3 exists to prevent.

lib/invoices, lib/proposals and lib/renewals stay here — copied, not
shared, which is the accepted cost of decision 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Push both repos and verify live**

```bash
cd /c/Wacrm/ozzo-partner && git push origin main
cd /c/Wacrm/wacrm-web   && git push origin main
```

Wait for both Vercel deployments. Then, on the live sites:

1. `partner.ozzo.co.in/proposals`, `/invoices`, `/renewals`, `/calculator`, `/forecast` and `/settings/invoice` all load with the real rows.
2. A proposal PDF and an invoice PDF both print at A4.
3. `app.ozzo.co.in/admin` no longer lists the six, and `app.ozzo.co.in/admin/invoices` 404s.
4. Sign in as a Sales Executive (or temporarily assign that role) and confirm: no Invoices, no Renewals, no Forecast in the sidebar, `/invoices` 404s, `/calculator` loads **without** a "Save as proposal" button.

Item 4 is the one that proves the push did what it was for. A hidden link with a working URL behind it is `rbac-not-enforced-at-data-layer` all over again.

- [ ] **Step 8: Tell the founder, in plain English, the two things he must do**

Write it in the reply, not in a file he has to find:

1. **His bookmarks changed.** `app.ozzo.co.in/admin/invoices` → `partner.ozzo.co.in/invoices`, and the same for proposals, renewals, the calculator and the forecast. Invoice settings is now inside Settings on the partner portal.
2. **One SQL block to paste** into the Mumbai SQL Editor: `wacrm-web/docs/RUN-THIS-SQL-partner-phase-3.md`. Until it is pasted, a proposal cannot be linked to a customer; everything else in this push works without it.

- [ ] **Step 9: Update `COPIED-FROM.md` and the memory**

Every file this push copied, with the `wacrm-web` commit it came from. Then record the phase as built, and what is left: Push 2 (Lead Discovery, WhatsApp Sender, the extension's address) and Push 3 (Dashboard).

---

## Self-review against the spec

| Spec requirement | Where it is done |
|---|---|
| Sales Proposals move, with `print/proposal/[id]` | Tasks 2, 3 |
| Invoices + Invoice Settings move, with `print/invoice/[id]` | Tasks 6, 7, 8 |
| Renewals move | Task 9 |
| Price Calculator moves | Task 4 |
| Business Forecast moves | Task 5 |
| `requireFounder()` → `requirePartnerRight(key)` | "The three mechanical edits"; pinned per route in Tasks 2, 6, 8, 9 |
| Rights enforced before the service client | Guard tests in Tasks 2, 6, 8, 9 |
| `/admin` routes and nav links deleted **in the same push** | Task 11 |
| Rights registry trimmed to this portal's modules, no new keys | "The three mechanical edits", step-level verification in each task |
| A customer shows its account's invoices, renewal date **and proposals** | Task 10 |
| Bookmarks will 404 — he needs telling once | Task 11 step 8 |

Not in this push, by the founder's own split: Lead Discovery and WhatsApp Sender (Push 2), the Dashboard (Push 3). Complaints & Suggestions is Phase 4 of the spec and is not a copy job — it is not in his list and is not planned here.

## Risks specific to this push

1. **The money must read the same after the move.** The only real check is a before-and-after comparison on live rows, which is why Task 11 step 1 comes before any deletion and Task 7 step 4 refers back to it. A copied `invoiceTotals()` with one lost line would otherwise be invisible until a customer queried an invoice.
2. **`invoices/new` reads `platform_proposals` directly.** It ports unchanged, but it means Invoices depends on the proposals *table* even though it does not call the proposals *API*. Deleting proposals later without noticing would break invoice prefill.
3. **recharts is new to this app.** A major-version drift from `wacrm-web` shows up as a chart that renders nothing, not as an error. Pinned to `^3.8.1` in Task 1 step 2.
4. **Two apps writing one dataset, briefly.** Between the partner deploy and the `wacrm-web` deploy in Task 11 step 7, both can write invoices. Push both within the same session and check item 3 of the live verification before walking away.

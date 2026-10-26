# OZZO Design System V1.0 — Phase 1 Audit

**Date:** 2026-10-26 · **Scope:** `wacrm-web` (Next.js web app) only · **Method:** static inspection of the repository. No file was modified. No database was touched.
**Baseline:** `npm run typecheck` → **exit 0** (clean before any work starts).

> This is the Phase 1 deliverable. It records what exists, why the UI is inconsistent, what to reuse, and what to build. It proposes no code changes until approved.

---

## 0. Two corrections to the brief before anything else

**1. There is no OZZO orange.** The brief says to preserve "the existing OZZO orange primary-action treatment". The web app has no orange primary. The default accent is **violet `#7834e8`** (`lib/themes.ts:26` → `DEFAULT_THEME = "violet"`), which matches the brand artwork exactly (brand violet is `#7935E8`). The app also lets each user pick one of **five** accents — violet, emerald, cobalt, amber, rose — so the primary colour is not even fixed per tenant. Amber `#f0941d` is the nearest thing to orange and it is one optional choice out of five.
**Assumption used in this audit:** preserve the existing 5-accent system and keep violet as the default. Nothing in this plan hardcodes a primary colour. If you actually want OZZO to be orange everywhere, that is a separate brand decision, and it is a one-line change in `globals.css` — say so and I will do it instead.

**2. The control-height targets contradict a decision made four days ago.** The brief asks for 36–40px buttons and ~40px inputs. The shipped desktop sizes are **32px** (`h-8`), set deliberately on 2026-10-22 as the "desktop density + viewport fill" programme, so that 26 data grids fit more rows on a 1366×768 laptop. Mobile already gets 44px (`h-11 md:h-8`), which is the correct accessibility target.
**Assumption used in this audit:** keep 32px as the desktop control height and make **everything** match it, rather than growing every control by 25% and undoing the density work. The real problem is not the number — it is that there are **five different heights in use**. See §2.1.

---

## 1. Architecture as it actually is

| Layer | What is there |
|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript. 171 `page.tsx` files, **~130 of them under `(dashboard)`**. |
| Styling | **Tailwind v4** via `@tailwindcss/postcss`. **No `tailwind.config.*` file at all** — all configuration is CSS, in `src/app/globals.css` (821 lines). |
| Component base | shadcn (`style: base-nova`), but the primitives sit on **Base UI** (`@base-ui/react`), not Radix. Lucide icons. |
| One Radix leftover | `@radix-ui/react-progress`, used by `ui/progress.tsx` only. Single-component dependency. |
| Data layer | Supabase + TanStack Query. ESLint already forbids UI → Supabase imports via `no-restricted-imports`. |
| Tests | 201 Vitest files (nearly all logic, not UI). Playwright responsive suite: 4 specs × 6 viewports × 3 engines. |
| a11y tooling | **None.** No `eslint-plugin-jsx-a11y`, no `axe`, no visual-regression baselines. |

### 1.1 The three token systems that do not talk to each other

This is the centre of the problem.

1. **`src/app/globals.css` — real, shipped, incomplete.**
   Excellent colour work: light/dark mode × 5 accents as two orthogonal dimensions, every colour declared hex-first then oklch for old-browser fallback, semantic `--success / --warning / --info / --pending / --draft`, a generated Tailwind-palette fallback block. Radius is tokenised (`--radius` + 7 derived steps).
   **Missing entirely: no typography tokens, no spacing tokens, no control-height tokens, no z-index tokens, no layout-dimension tokens.**

2. **`src/lib/design-tokens.ts` — complete, and completely dead.**
   215 lines defining `spacing`, `radius`, `typography`, `animation`, `breakpoints`, `zIndex`, `layout`, `button.heights`, `avatar`, `icon`, plus `DIALOG_SIZES` and `DRAWER_SIZES`. It is **imported exactly once in the whole app**, and only for `STATUS_MAPPINGS` (`components/shared/status-badge.tsx:5`). The `tokens` object, `DIALOG_SIZES` and `DRAWER_SIZES` have **zero consumers**.
   Worse, it has drifted into being wrong: it claims `sidebarWidth: 16rem` (actual: `lg:w-52` = 13rem), `tableRowHeight: 3rem` (actual: `h-8` = 2rem), `pagePadding: 1.5rem` (actual: `px-4` = 1rem), `pageMaxWidth: 1440px` (actual: `max-w-none`), `radius.md: 6px` (actual: 8px). Anyone who starts using it today will produce *new* inconsistency.

3. **~500 inline Tailwind strings in page files — the de facto system.**
   Measured across `src/app` + `src/components`:

   | Pattern | Count |
   |---|---|
   | `grid-cols-*` declarations | **497** |
   | hand-written `<Label>` elements | **370** across 80 files |
   | raw `<button>` elements | **312** across 146 files (vs 767 `<Button>`) |
   | hardcoded height overrides in a `className` | **534** |
   | arbitrary font sizes outside the scale (`text-[9px]`…`text-[28px]`) | **350** |
   | `text-red-*` (raw palette) vs `text-destructive` (token) | **288 vs 106** |
   | distinct `space-y-*` values | 12 |
   | distinct `gap-*` values on grids | 9 |
   | distinct `max-w-*` values on dialogs/containers | 13+ |
   | distinct z-index values, incl. `z-[9999]` and `z-[500]` | 8 |
   | files with ad-hoc `animate-spin` loaders | **164** |
   | files calling native `confirm()` | **33** |
   | files hand-rolling raw `<table>` HTML | **40** |

### 1.2 Root causes (not "people were sloppy")

**RC-1 — The standard is written but never wired up.** This is the dominant cause, and it is provable:
- `custom-fields-section-renderer.tsx` exports `PAGE_FIELD_GRID` and `SECTION_HEADER_CLASS` with doc comments saying *"the canonical field grid… every 'as page' form uses this exact grid"* and *"the one section-header style shared by the renderer, FormSection and every hand-built section"*. **Both have zero importers.** The exact same grid string is instead copy-pasted into 6 files, and `FormSection` inlines its own copy of the header style.
- `design-tokens.ts` — as above, 215 lines, one import.
- `shared/loading-state.tsx` exports `PageLoader`, `TableSkeleton`, `InlineLoader`. Usage: 20 / 2 / **0** files — against 164 files with their own `animate-spin`.
- `shared/confirm-dialog.tsx` exists and is used in 16 files; 33 other files call native `confirm()`.
- `shared/page-toolbar.tsx` exists and is used in **6** files out of ~130 routes.

**RC-2 — Nothing enforces anything.** ESLint already demonstrates the mechanism (`no-restricted-imports` guards the data layer, and it works). There is no equivalent rule for UI: nothing stops a new `<button className="h-7 …">`, a raw `<table>`, or a `text-red-500`.

**RC-3 — The shared layer grew list-page-first.** The recent programmes (table filter row, saved views, toolbar-line removal, desktop density, settings layout) were *very* effective — but each covered one surface. Result: **list pages are now genuinely standardised, and detail pages have no pattern at all.**

**RC-4 — Primitives arrived in two eras and were never reconciled.** `Button`/`Input`/`Select` were rewritten on Base UI with `rounded-lg` and a `focus-visible:ring-3 ring-ring/50` focus system. `SearchableSelect`/`MultiSelect`/`CollaboratorsSelect`/`AsyncSearchSelect` are still the older shadcn-v1 shape: `rounded-md`, `focus:ring-1 ring-primary` or `focus:ring-2 ring-offset-2`, and a **filled `bg-muted`** surface. They were never migrated, so they sit side by side in one form row looking like two different products.

**RC-5 — `PageHeader` lost its title and nobody cleaned up.** `shared/page-header.tsx` still accepts `title` and `subtitle` and its doc comment still says *"renders as an h1 at 24px/700"* — but the JSX **never renders either prop**. The real page title now comes from a **hand-maintained route→title map** in `components/layout/header.tsx:23-60` (37 entries). Every `/x/new` and `/x/[id]` route falls through to the list title by prefix match, so **"Add Customer" shows "Customers" in the topbar**, and detail pages get the module name instead of the record name.

---

## 2. Findings by surface

### 2.1 🔴 Controls — five different desktop heights, three focus rings, two surfaces

This is the finding that explains most of what you can see on screen.

| Component | Desktop height | Radius | Focus ring | Surface |
|---|---|---|---|---|
| `Button` | **32px** `h-8` | `rounded-lg` | `ring-3 ring-ring/50` | `bg-primary` |
| `Input` | **32px** `h-8` | `rounded-lg` | `ring-3 ring-ring/50` | transparent |
| `SelectTrigger` | **32px** `h-8` | `rounded-lg` | `ring-3 ring-ring/50` | transparent |
| `CustomFieldInput` | **36px** `h-9` | inherited | inherited | **`bg-muted`** (forced) |
| `CollaboratorsSelect` | **36px** `h-9` | `rounded-md` | `ring-2` + offset | `bg-background` |
| `SearchableSelect` | **~36px** (no height class; `py-2`) | `rounded-md` | `ring-1 ring-primary` | **`bg-muted`** |
| `AsyncSearchSelect` | **40px** `h-10` | `rounded-md` | `ring-1 ring-primary` | **`bg-muted`** |
| `MultiSelect` | **40px** `min-h-10` | `rounded-md` | `ring-2` + offset | `bg-background` |
| `Textarea` | `min-h-16` | `rounded-lg` | `ring-3` | transparent |

Consequence: put a text field next to a searchable dropdown — which every customer, lead, deal and order form does — and you get a 32px box beside a 40px filled box with a different corner radius and a different focus ring. **And because `CustomFieldInput` forces `bg-muted`, a tenant's custom fields look different from the predefined fields in the same section of the same form.**

Two more defects found in the same components:

- 🐞 **Dropdown panels do not match their trigger width.** `SearchableSelect`, `AsyncSearchSelect` and `MultiSelect` size their popup with `w-[--radix-popover-trigger-width]`. The popover is **Base UI**, not Radix — that variable does not exist, so the width rule silently does nothing. Base UI's equivalent is `--anchor-width`, which `ui/select.tsx` already uses correctly (`w-(--anchor-width)`).
- ⚠️ `SelectTrigger` defaults to **`w-fit`**, not `w-full`, so every caller must remember `className="w-full"` — and the ones that forget produce a short select in a full-width grid cell.

### 2.2 🟢 List pages — already standardised. Do not touch the engine.

`DataTable` (`ui/data-table/`, 2,008 lines across 6 files) is the strongest asset in the codebase and must be **wrapped, not rebuilt**. It already does: per-column filter row, saved views, Manage Columns, row selection + bulk actions, server-side paging, CSV export, sticky header/filter/pagination, `fill` height behaviour, hover-prefetch with a busy row (the fix for the "dead first click"), and a portal that puts its controls into the page header.

Measured across the 12 main list routes (`leads`, `contacts`, `products`, `quotations`, `orders`, `dispatches`, `payments`, `expenses`, `stock`, `pipelines`, `team/employees`): **all** use `PageLayout` + `PageHeader` + `DataTable` + `fill`. Row height is a consistent `h-8` with `py-0.5` cells.

Remaining gaps here are small:
- `team/roles` uses `DataTable` but no `PageLayout`/`PageHeader` (keeps an inline fallback toolbar).
- `DataTable` still carries a dead `search` prop, documented as "accepted and ignored", passed by ~20 screens.
- The pagination bar hand-builds its own controls (`h-11 md:h-7` buttons, a raw `<select>`), bypassing `Button`/`Select`.

### 2.3 🔴 Create/edit forms — a shell exists, a field does not

There *is* a form system: `FormPageShell` + `FormSection` + `FormActions`. Adoption of 17 real forms:

| Primitive | Adopters |
|---|---|
| `FormPageShell` | 11 / 17 |
| `FormActions` | 8 / 17 |
| `FormSection` | 7 / 17 |

Non-adopters: `scheme-form` (568 lines — and `FormPageShell`'s own doc comment says the look *came from* this file, so the reference implementation is the one that drifted), `announcement-form`, `module-automation-form`, `leave-form-dialog`, `territory-form-dialog`, `password-form`. `order-form`, `quotation-form` and `dispatch-form` use the shell but not `FormActions`, so their Save/Cancel differs from everyone else's.

The structural gap is bigger than adoption:

- 🔴 **There is no `FormField`.** Label + required marker + control + helper text + error is hand-written **370 times across 80 files**. The required asterisk is written three different ways (`text-destructive">*` ×16, `text-red-500">*` ×7, bare `*</span>` ×17).
- 🔴 **`react-hook-form` and `zod` are installed and used in 2 files.** Every other form is `useState` + hand-rolled validation, which is why validation messages, error colours and error placement differ per module.
- 🐞 **`FormPageShell` double-pads every create/edit page.** The shell `<main>` already applies the page gutter (`px-3 py-3 … lg:px-4 lg:py-2.5`); `FormPageShell` adds its own `p-4 sm:p-5` on top. This is precisely the bug that was fixed for list pages by removing `PageLayout`'s padding — `FormPageShell` never got the same fix.
- ⚠️ **`FormPageShell` renders a second page title.** Its `<h1>` is `text-lg sm:text-xl` while the topbar already shows a title from the route map, and `FormPageShell`'s back button is a raw `<button>`, not `Button`.
- ⚠️ Field grid: the canonical 1→2→3→4 column grid is right, but copy-pasted into 6 files instead of imported from `PAGE_FIELD_GRID`.

### 2.4 🔴 Detail pages — Pattern 4 does not exist

**Not one of the 12 record-detail pages uses `PageLayout` or `PageHeader`.** Each hand-rolls its own `<h1>`, its own container and its own section layout:

| Route | Container |
|---|---|
| `contacts/[id]`, `deals/[id]`, `products/[id]` | `space-y-6 w-full max-w-none flex flex-col h-full` |
| `orders/[id]`, `payments/[id]`, `dispatches/[id]` | `space-y-6 w-full max-w-none` |
| `expenses/[id]` | `space-y-6` |
| **`leads/[id]`** | **`mx-auto w-full max-w-7xl`** — the only centred, width-capped page in the app |
| `team/employees/[id]` | its own `<Card>`-based layout (the only page using `Card`) |

On top of that, 8 detail pages hand-roll raw `<table>` HTML for their line items (`orders/[id]` has three separate ones), and `StatusBadge` is used on only 2 of the 12 — the rest colour their status inline.

### 2.5 🟠 Reports — internally consistent, inconsistent with the app

11 of the 15 report pages are the identical string `flex flex-col h-full space-y-4 p-8` wrapping `<ReportViewer>`. Good news: one `ReportPageLayout` replaces all 11. Bad news:
- `p-8` sits **on top of** the shell's `lg:px-4`, so reports have a ~48px gutter where every other page has 16px.
- `h-full` is used instead of the `fill` mechanism the rest of the app uses, so report tables don't participate in the viewport-fill system.
- `/reports` and `/reports/stock` are `p-8 text-center` placeholder pages.
- **Three KPI card implementations:** `dashboard/metric-card.tsx` (shared, 66 uses), `reports/report-kpi-cards.tsx`, and two private `StatCard` copies (`broadcasts/[id]/page.tsx:50`, `admin/page.tsx:24`).

### 2.6 🟡 Settings — recently standardised, treat as done

All 25 panels run on `SettingsPanel` / `SettingsCard` / `SettingsRow` (2026-10-23). Remaining issue: 14 of the 33 native `confirm()` call sites are settings panels.

### 2.7 🟠 Superadmin (`/admin`) — founder-only, 20+ raw-table pages

Lowest priority. Worth stating explicitly so "all modules standardised" is never claimed while these exist.

### 2.8 Responsive & accessibility

What exists and works:
- `.app-shell` / `.app-main` locked-height shell above 1024px, normal page scroll below — with `100dvh` + an `@supports` fallback, and a comment explaining why the fallback can't be a duplicate declaration.
- `overflow-x: clip` (not `hidden`, correctly — `hidden` breaks `position: sticky`).
- A global `min-height: 2.75rem` tap-target net below 768px that `min-height` makes un-overridable by a page's `h-7`.
- Playwright: `no-horizontal-scroll`, `touch-targets`, `bottom-control-reachable`, `filter-row` at 320/390/844/768/1024/**1440** × Chromium/Firefox/WebKit.

Gaps:
- **1366×768 and 1920×1080 are not tested.** The brief names both; the suite's only desktop size is 1440×900. 1366×768 is the size the density work was aimed at — it needs to be in the matrix.
- No `eslint-plugin-jsx-a11y`, no `axe` run, no visual-regression baselines.
- 312 raw `<button>` elements are outside the shared focus-ring system.
- 🐞 `components/custom-fields/custom-fields-section-renderer.tsx` imports `@/lib/supabase/client` from a component — which the existing ESLint `no-restricted-imports` rule forbids. Worth confirming `npm run lint` is actually clean before adding rules to it.

---

## 3. Reuse / consolidate / build

### Reuse as-is (do not rebuild)
`DataTable` + its 5 helpers · `globals.css` colour + radius token system · `TableToolbarSlot` · `Button`, `Input`, `SelectTrigger`, `Textarea`, `Label`, `Checkbox`, `RadioGroup`, `Switch`, `Dialog`, `Sheet`, `Popover`, `Tooltip` · `PageLayout` · `FormSection` · `FormActions` · `StatusBadge` + `STATUS_MAPPINGS` · `ConfirmDialog` · `EmptyState` · `CustomFieldsSectionRenderer` (the engine) · the Settings panel trio · `ReportViewer` · `MetricCard` · the responsive shell CSS and Playwright suite.

### Consolidate (duplicates to collapse)
| Keep | Fold in |
|---|---|
| `Button` | 312 raw `<button>`; the `DataTable` pagination controls |
| One select family | `SearchableSelect` + `AsyncSearchSelect` + `MultiSelect` + `CollaboratorsSelect` → one surface/radius/focus/height |
| `ConfirmDialog` | 33 native `confirm()` + 5 `alert()` |
| `PageLoader` / `TableSkeleton` | 164 ad-hoc `animate-spin` blocks |
| `MetricCard` | 2 private `StatCard`s; align `ReportKpiCards` to the same visual |
| `globals.css` tokens | `lib/design-tokens.ts` — **delete the dead `tokens`/`DIALOG_SIZES`/`DRAWER_SIZES`, keep `STATUS_MAPPINGS`** |
| `ui/progress.tsx` | re-implement without `@radix-ui/react-progress`, drop the dependency |

### Build (small, additive; ~8 new files)
1. **`FormField`** — label + required marker + control slot + helper + error. The single highest-value component in this plan: it retires 370 hand-written label blocks and unifies validation display.
2. **`FormGrid`** — exports the existing `PAGE_FIELD_GRID` as a component (`cols="page" | "dialog"`).
3. **`DetailPageLayout`** + **`DetailSection`** + **`DetailGrid`** (label/value pairs) — Pattern 4, which has no implementation today.
4. **`ReportPageLayout`** — replaces the 11 copies of `flex flex-col h-full space-y-4 p-8`.
5. **`LineItemsTable`** — a thin wrapper over `ui/table` for order/quotation/deal line items, replacing ~8 raw `<table>` blocks.
6. **`IconButton`** — a named `size="icon-sm"` + `aria-label` + tooltip wrapper, so row actions stop being raw buttons.
7. **Token additions to `globals.css`** — see §4.

No new dependency is needed. One is removed.

---

## 4. Proposed token specification (Phase 2)

Added to `globals.css` `@theme inline` so they are real Tailwind utilities, in the same file as the colours. Values are **measured from what ships**, not invented — so Phase 2 changes nothing visually and is safe to land on its own.

```css
/* control heights — 44px touch below md, compact above (existing policy) */
--size-control:        2rem;    /* 32px — Button/Input/Select desktop (as shipped) */
--size-control-sm:     1.75rem; /* 28px */
--size-control-lg:     2.25rem; /* 36px */
--size-control-touch:  2.75rem; /* 44px — below md, as shipped */

/* typography — body 14 / label 13 / table 12-13 / page title 20 / section 14 */
--text-page-title: 1.25rem;   --text-page-title--line-height: 1.75rem;
--text-section:    0.875rem;  --text-body:  0.875rem;
--text-label:      0.8125rem; --text-table: 0.8125rem;
--text-caption:    0.75rem;   --text-micro: 0.6875rem;   /* replaces text-[11px] */

/* layout — measured */
--layout-header-h:       3.5rem;  /* h-14 */
--layout-sidebar-w:      13rem;   /* lg:w-52 */
--layout-page-gutter:    1rem;    /* lg:px-4 */
--layout-page-gutter-sm: 0.75rem; /* px-3 */
--layout-row-h:          2rem;    /* h-8 */
--layout-grid-min-h:     17.5rem; /* 280px fill floor */

/* z-index — replaces z-[9999] / z-[500] */
--z-dropdown: 10; --z-sticky: 20; --z-overlay: 30;
--z-modal:    40; --z-popover: 50; --z-tooltip: 60; --z-toast: 70;

/* spacing — 4px base, named for the three decisions pages keep re-making */
--space-page-section: 0.5rem;  /* PageLayout space-y-2 */
--space-form-field:   1rem;    /* field grid gap-4 */
--space-form-section: 1.5rem;  /* between form sections */
--space-toolbar-gap:  0.5rem;
```

Colour: unchanged. 5 accents preserved, violet default, `--success/--warning/--info/--pending/--draft` already exist and are already paired with text or an icon (no colour-only status), which satisfies the brief's requirement.

---

## 5. Files likely to change

**Phase 2 (tokens) — 2 files**
`src/app/globals.css` (add token block) · `src/lib/design-tokens.ts` (strip dead exports, keep `STATUS_MAPPINGS`)

**Phase 3 / Batch 1 (foundation) — ~18 files**
`ui/button.tsx`, `ui/input.tsx`, `ui/select.tsx`, `ui/textarea.tsx`, `ui/searchable-select.tsx`, `ui/async-search-select.tsx`, `ui/multi-select.tsx`, `ui/collaborators-select.tsx`, `ui/custom-field-input.tsx`, `ui/progress.tsx` · new `shared/form-field.tsx`, `shared/form-grid.tsx`, `shared/icon-button.tsx`, `shared/detail-page-layout.tsx`, `shared/report-page-layout.tsx`, `shared/line-items-table.tsx` · `shared/page-header.tsx` (remove the dead `title`/`subtitle`, or restore them) · `shared/index.ts`

**Batch 2** `components/leads/lead-form.tsx`, `components/contacts/contact-form.tsx`, `components/products/product-form.tsx`, `team/employees/new|[id]`, `contacts/[id]`, `leads/[id]`, `products/[id]` (~10 files)
**Batch 3** `components/pipelines/deal-form.tsx`, `quotations/quotation-form.tsx`, `orders/order-form.tsx`, `dispatches/dispatch-form.tsx`, `deals/deal-items-table.tsx`, `quotations/product-details-table.tsx`, 5 detail pages (~14 files)
**Batch 4** `payments/*`, `expenses/*`, location-tracking pages, 15 report pages, `schemes/scheme-form.tsx`, settings `confirm()` sites (~35 files)
**Phase 7** `eslint.config.mjs` + 4 new docs

**Never touched by this work:** `src/lib/**` business logic, `src/app/api/**`, `supabase/**`, `lib/plans/**` (plan gating), `lib/auth/**` (RBAC), any migration.

---

## 6. Risks and test strategy

| Risk | Why it is real here | Mitigation |
|---|---|---|
| **Cannot eyeball anything locally** | the dev server redirects every route to `/login`; the app has no view without a tenant session | verify by `typecheck` + `vitest` + `next build` + the Playwright suite against a **production build**, never the dev server. Visual checks happen on the deployed app. |
| **Growing a control re-breaks density** | the 280px grid floor and the sticky filter row's `top-8` are coupled to the 32px row height | keep 32px. Any height change must re-run `bottom-control-reachable` + `filter-row` at 1366×768. |
| **tailwind-merge traps** | a `md:`-prefixed class in a base `className` cannot be overridden by a caller's unprefixed one (this already shipped a bug: every in-input search icon drew over its placeholder) | the existing `ui/input-padding.test.ts` guards exactly this. Add one per primitive touched. |
| **`hsl(var(--x))` paints nothing** | these tokens hold complete colours, not bare channels | never wrap a token in `hsl()`. Grep for it in review. |
| **A `FormField` sweep can silently drop a field** | custom fields are DB-driven; `renderCustomSystemField` returning `null` instead of `undefined` makes predefined fields vanish | `visible-fields.test.ts` covers the contract. Migrate forms one module at a time and diff the rendered field list. |
| **Build-only failures** | an import placed above `"use client"` passes `tsc` and fails `next build` | `next build` is part of every batch's gate, not just `typecheck`. |
| **Regression in gating / permissions** | plan gates and RBAC decide what renders | this work touches no file under `lib/plans` or `lib/auth`; `roles.test.ts` and the surface-gate tests run each batch. |

**Per-batch gate:** `npm run typecheck` → `npm run test` → `npm run build` → `npm run test:responsive:laptop` (plus 1366×768 once added) → deploy to `main` → visual pass on `app.ozzo.co.in` for the touched routes. Nothing is reported standardised on a compile alone.

---

## 7. Recommended first batch

Phase 2 + Phase 3 Batch 1, in this order, each landing separately:

1. **Tokens** — add the `@theme` block; strip the dead `design-tokens.ts` exports. Zero visual change. *Gate: typecheck + build.*
2. **Reconcile the four select-family components** to the `Button`/`Input` shape: 32px desktop (44px touch), `rounded-lg`, `focus-visible:ring-3 ring-ring/50`, transparent surface; and **fix `w-[--radix-popover-trigger-width]` → `w-(--anchor-width)`**. Drop `bg-muted` from `CustomFieldInput` so custom and predefined fields match. **This is the change you will see most.**
3. **Build `FormField` + `FormGrid`** and migrate **one** form end to end — `lead-form.tsx` — as the reference. Nothing else migrates until that one is verified.
4. **Build `DetailPageLayout` / `DetailSection` / `DetailGrid`** and migrate **one** detail page — `contacts/[id]`.
5. **Fix `FormPageShell`'s double padding**; decide `PageHeader`'s dead `title`/`subtitle` (remove, or render and retire the route-title map).
6. **Add 1366×768 and 1920×1080** to the Playwright viewport matrix.

Deliverables 3 and 4 are the reference implementations every later batch copies. They are the point of Batch 1 — not the volume.

---

## 8. Open questions for approval

1. **Control height** — confirm 32px desktop stays (and everything else comes down to it), rather than raising everything to 36–40px and undoing the 2026-10-22 density work.
2. **Accent colour** — confirm the 5-accent system and violet default stay. (If OZZO should be orange, that is a separate one-line brand change.)
3. **Page titles** — keep the topbar route-map title and delete `PageHeader.title`/`.subtitle`, or restore the in-page title and retire the map? Today's behaviour shows "Customers" on the Add Customer screen.
4. **Superadmin `/admin`** — in scope for Batch 4, or explicitly excluded as founder-only?
5. **`react-hook-form`** — adopt it inside `FormField` for new/migrated forms (it is already a dependency), or keep `useState` forms and standardise only the markup? Recommendation: markup first, `react-hook-form` only where a form is already being rewritten.

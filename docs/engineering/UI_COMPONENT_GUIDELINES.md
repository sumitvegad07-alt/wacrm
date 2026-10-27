# OZZO UI Component Guidelines

**The short version:** import it, don't re-style it. If you are writing a
`className` with a height, a font size, a colour or a grid in it, there is
probably a component that already made that decision.

Companion: [PAGE_PATTERNS.md](./PAGE_PATTERNS.md) — which page template to use.
History: [UI_DESIGN_SYSTEM_AUDIT_2026-10-26.md](./UI_DESIGN_SYSTEM_AUDIT_2026-10-26.md) — what was wrong and why.

---

## 1. Where the tokens live

**`src/app/globals.css`, in the `@theme inline` block. Nowhere else.**

That is the only place Tailwind can turn a token into a utility and the only
place the browser reads. It holds colour (light/dark × 5 accents), radius,
control heights, the type scale, stacking order, and layout dimensions.

| What | Tokens |
|---|---|
| Control height | `h-control` (32px) · `h-control-sm` (28) · `h-control-lg` (36) · `h-control-touch` (44) |
| Type scale | `text-micro` (11) · `text-caption` (12) · `text-table` (13) · `text-label` (13) · `text-body` (14) · `text-section` (14) · `text-page-title` (20) |
| Stacking | `z-dropdown` · `z-sticky` · `z-overlay` · `z-modal` · `z-popover` · `z-tooltip` · `z-toast` |
| Colour | `primary` · `destructive` · `success` · `warning` · `info` · `pending` · `draft` · `muted` · `card` · `border` |
| Layout (read in calc) | `--layout-header-h` · `--layout-sidebar-w` · `--layout-page-gutter` · `--layout-row-h` · `--layout-grid-min-h` |

### `src/lib/design-tokens.ts` is NOT the design system

It used to be: a 215-line object covering spacing, typography, radius, z-index
and layout. It had **one import in the entire app**, and because nobody read it,
it had drifted into being factually wrong — it claimed a 16rem sidebar (it is
13rem), a 3rem table row (2rem), 1.5rem of page padding (1rem), a 6px `md`
radius (8px). It now holds only `STATUS_MAPPINGS`, which is data, not styling.

**Do not reintroduce a TypeScript mirror of the tokens.** A second source of
truth is exactly what produced the drift. ESLint blocks importing the old
exports.

### Two traps that make a new token paint nothing

1. **`cn` has to be told the token names.** tailwind-merge routes any
   unrecognised `text-*` into the *colour* group, so `cn("text-body","text-xs")`
   keeps both and the later rule wins — the caller's smaller size silently never
   applies. Add every new token name to the lists in `src/lib/utils.ts`.
   Guarded by `src/lib/utils.test.ts`.

2. **`hsl(var(--token))` paints nothing.** These tokens hold complete colours
   (oklch with a hex fallback), not bare HSL channels. It has shipped twice —
   once on a scrollbar, once on the location-tracking map's GPS trail, which
   drew no line at all. Use `var(--token)` or a Tailwind class. ESLint blocks it
   in TS/TSX; `lib/theme/color-fallbacks.test.ts` blocks it in CSS.

### A third trap, about overriding

A **responsive** base class cannot be overridden by a caller's plain class.
tailwind-merge only drops a base class at the *same* variant, and Tailwind emits
media queries last — so `md:px-2.5` in a base beats a caller's `pl-9`. That is
why every search box in the app once drew its magnifier over its placeholder.
**Write base padding unprefixed.** Guarded by `ui/input-padding.test.ts`.

The flip side is useful: a legacy call site still passing `h-10` gets the
correct 32px on desktop anyway, because the primitive's `md:h-control` wins.

---

## 2. Controls

Everything composes from **`src/components/ui/control-base.ts`**: one surface,
one radius, one focus ring, one height pairing. Before it there were five
desktop heights, two radii, three focus rings and two surfaces, so a text field
and the searchable dropdown beside it in the same form row disagreed on all
four.

| Need | Use |
|---|---|
| Any button | `<Button>` — `variant` default/outline/secondary/ghost/destructive/link, `size` default/xs/sm/lg/icon* |
| Text, number, email, date, file | `<Input>` |
| Long text | `<Textarea>` |
| Short fixed list | `<Select>` + `<SelectTrigger>` |
| Long / searchable list | `<SearchableSelect>` |
| Server-backed search | `<AsyncSearchSelect>` |
| Many values | `<MultiSelect>` |
| People picker | `<CollaboratorsSelect>` |
| Tenant-configured field | `<CustomFieldInput>` (driven by the DB; you rarely call it directly) |

**32px on desktop / 44px on touch is deliberate.** 32px is what lets a 1366×768
laptop show a useful number of grid rows; 44px is the Apple/Google touch target.
Do not "fix" either number without re-running `npm run test:responsive:desktop`.

Notes:

- `SelectTrigger` defaults to **`w-fit`** on purpose — 52 of 79 triggers are
  filter and toolbar selects that should hug their value. `FormField` applies
  `w-full` by `data-slot` where it matters.
- Popovers are **Base UI**, so panel width is `--anchor-width`, not Radix's
  `--radix-popover-trigger-width`. Use `controlPanelWidthClassName`.
- The primitives are Base UI (`@base-ui/react`). **Do not add Radix
  dependencies** — ESLint blocks it. `ui/progress.tsx` is the one exception left
  and is slated for removal.

---

## 3. Forms

```tsx
<FormSection title="Financial Settings">
  <FormGrid>
    <FormField label="Credit Limit" hint="Leave blank for no limit">
      <Input type="number" value={v} onChange={…} />
    </FormField>
    <FormField label="GST Number" required error={errors.gst?.message} span={2}>
      <Input value={v} onChange={…} />
    </FormField>
  </FormGrid>
</FormSection>
```

`FormField` owns the label, the **one** required marker, the error, the hint,
`aria-describedby`, `aria-invalid`, a generated id so clicking the label focuses
the field, and full-width controls. This markup used to be hand-written **370
times across 80 files**, with the asterisk in four different spellings and the
error colour split 279 raw `text-red-*` against 106 `text-destructive`.

- `span` — `1` (default), `2`, `3`, `4`, `"full"`. Use it for addresses, terms,
  long descriptions. **Don't stretch short fields**; that is the other half of
  the problem a grid solves.
- `hint` for helper text, `error` for validation. `error` replaces `hint` so the
  two never stack and shift the row.
- `labelClassName` only when the label text is *data* (the custom-fields
  renderer passes `capitalize`). Never to change size or weight.
- `FormGrid variant="page"` → 1/2/3/4 columns. `variant="dialog"` → caps at 2.
- Save/Cancel is **`<FormActions>`**. Never hand-roll a footer.
- Most fields in Leads/Customers/Deals/Products come from
  `CustomFieldsSectionRenderer`, which is already on `FormField`. A
  `renderCustomSystemField` handler must return the **control only** — the
  renderer wraps it in a labelled field, so a `<Label>` there is a second label
  stacked on the first (which shipped on two customer fields).

`react-hook-form` is a dependency and is used by 2 forms. Use it for new forms
if you like; `FormField.error` takes its messages directly.

---

## 4. Confirmations, loading, empty, status

```tsx
const confirm = useConfirm();
if (!(await confirm({ title: "Delete this quotation?", variant: "danger" }))) return;
```

**Never `window.confirm` or `alert`.** ESLint blocks both in the tenant app.
`useConfirm()` returns a promise, so it works where a controlled dialog cannot —
including gating the *middle* of a save function. Outside a provider it falls
back to `window.confirm`, so print routes and tests still work.

| Need | Use |
|---|---|
| Confirm an action | `useConfirm()` |
| Confirm, controlled | `<ConfirmDialog>` |
| Page loading | `<PageLoader>` |
| Table loading | `<TableSkeleton>` |
| Nothing to show | `<EmptyState>` |
| A record's status | `<StatusBadge status={row.status} />` |
| Toasts | `toast.success` / `toast.error` from `sonner` |

`StatusBadge` maps the stored value through `STATUS_MAPPINGS`, so "Active" looks
the same in every module. Only hand-roll a `<Badge>` when the colour is the
tenant's own data (a pipeline stage colour), not a semantic state.

---

## 5. Tables

| Need | Use |
|---|---|
| A list screen | `<DataTable>` |
| A read-only table inside a page | `<LineItemsTable>` + `Head`/`Row`/`Cell` |
| An editable line-item grid | the module's own grid (order, quotation, deal) |

**Do not rebuild `DataTable`.** It is 2,000 lines and already does per-column
filters, saved views, column management, selection, bulk actions, server paging,
CSV export, sticky header/filter/pagination, `fill` height, and hover-prefetch
with a busy row — the last of which is the fix for the "dead first click".

`LineItemsTable` exists because `DataTable` is the wrong tool for a nested
read-only table (no filters, no paging, doesn't own the page), which is why 40
files once hand-rolled `<table>` and drifted on header background, cell padding,
text size and min-width. Pass `onClick` to `LineItemsRow` and the row becomes
keyboard-reachable as well as clickable.

---

## 6. Enforcement

Two mechanisms, deliberately different:

**ESLint — hard errors, for patterns already at zero.** `hsl(var(`, Radix CSS
vars, the copy-pasted field-grid literal, native `confirm`/`alert`, the dead
`design-tokens` exports, new Radix imports. These are errors because they are
achievable today.

**`npm run lint:ui` — a ratchet, for patterns with real debt.** 212 raw
`<button>`, 192 `text-red-*`, 301 arbitrary font sizes and so on. It counts them
against `scripts/design-system-baseline.json` and fails only when a count goes
**up**. Existing code is allowed; new code is not.

Cleaned some up? Lock it in:

```bash
npm run lint:ui -- --update
```

A rule nobody can pass is noise, not a rule. That is also why `npm run lint`
cannot be the gate yet: it carries ~300 pre-existing errors (mostly
`no-explicit-any` and the Supabase-in-components rule) from before this
programme. Getting that to zero is its own piece of work.

### Checks before you say it works

```bash
npm run typecheck && npm run lint:ui && npm run test && npm run build
```

`next build` is not optional: an import placed above `"use client"` passes
`tsc` and fails the build.

**You cannot eyeball a change locally** — the dev server redirects every route
to `/login`. Verification is typecheck + tests + build, then a visual pass on
the deployed app.

---

## 7. When an exception is right

Deviate when the shared component genuinely cannot express what the screen
needs — not because it is faster to type a `className`. When you do:

1. Leave a comment saying what the component could not do.
2. If it will recur, extend the component instead.
3. If you add to a ratcheted count, say why in the commit message and re-record
   the baseline.

Known, deliberate exceptions today:

- `src/app/(superadmin)` — founder-only, out of scope by agreement.
- `components/landing` — marketing page; its `alert()` fakes an AI reply in a demo.
- `ui/progress.tsx` — the last Radix import.
- Editable line-item grids in order/quotation/deal — shells aligned, components
  not merged, because their bodies and save paths genuinely differ.

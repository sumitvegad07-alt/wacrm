# OZZO Page Patterns

Every screen in the app is one of six patterns. Pick one before you write any
markup; don't invent a seventh.

Companion: [UI_COMPONENT_GUIDELINES.md](./UI_COMPONENT_GUIDELINES.md) — which component to use inside the page.

---

## The rule that applies to all six

**The page gutter belongs to the workspace `<main>` in
`src/app/(dashboard)/dashboard-shell.tsx`, and nowhere else.**

```
px-3 py-3 pb-6  sm:px-4 sm:pb-6  lg:px-4 lg:py-2.5 lg:pb-2.5
```

Any `p-*`, `px-*` or `mt-*` you add at the top of a page is a *second* gutter.
This has been fixed four separate times: `PageLayout` once added its own,
`FormPageShell` did until Batch 1, `team/employees/[id]` had `p-4 sm:p-5`,
`quotations/[id]` had `px-6 mt-6`, and 13 report pages had `p-8` — which gave
reports a 48px margin where every other page had 16px.

Likewise, don't cap the width. `leads/[id]` and `visits/[id]` were the only
centred, `max-w`-capped pages in the app, so those records were narrower than
every other screen on a wide monitor.

---

## Pattern 1 — List / master data

**Leads · Customers · Products · Employees · Territories**

```tsx
<PageLayout fill>
  <PageHeader actions={<Button>Add Customer</Button>} />
  <DataTable
    columns={columns}
    data={rows}
    tableView={tableView}
    rowHref={(r) => `/contacts/${r.id}`}
    selection={selection}
    fill
  />
</PageLayout>
```

- `fill` on both: the page claims the leftover viewport height and the grid
  scrolls *inside* it, which is what keeps the pagination bar on screen.
  There is a 280px floor, so a short viewport scrolls the page rather than
  crushing the grid.
- `rowHref`, not `onClick` + `router.push`. Knowing the destination lets the
  table prefetch on hover and show the row as busy — the fix for the "dead
  first click", which was a ~900ms cold navigation with no feedback.
- Filters, column management, sorting, selection and saved views come from
  `DataTable` + `useTableView`. Don't add your own search box; every column has
  its own filter.
- **No KPI cards on simple master data.** Keep them for transactional lists
  where a total means something.
- The page title is **not** set here — see "Page titles" below.

## Pattern 2 — Transactional list

**Deals · Quotations · Orders · Dispatch · Payments · Expenses**

Pattern 1 plus status filters, date ranges, amount totals, workflow actions and
approval states. Same `PageLayout fill` + `DataTable fill` foundation; the extras
are columns, filters and toolbar actions, not a different layout.

Only show a metric that changes a decision.

## Pattern 3 — Create / edit form

**Add Customer · Add Employee · Create Quotation**

```tsx
<FormPageShell
  icon={Users}
  title="Add New Customer"
  onBack={() => router.back()}
  width="none"                       // "none" for wide, table-heavy masters
  footer={<FormActions onCancel={…} onSave={…} saveLabel="Create Customer" />}
>
  <FormSection title="Primary Details">
    <FormGrid>
      <FormField label="Company Name" required>…</FormField>
    </FormGrid>
  </FormSection>
</FormPageShell>
```

- Labels always above the control. Two columns is the default; `FormGrid`'s
  page variant goes 1 → 2 → 3 → 4 as the screen allows, and the dialog variant
  caps at 2.
- `span` the fields that need width (address, terms, description); leave short
  fields alone.
- Save/Cancel is always `<FormActions>` — right-aligned, Save primary, Cancel
  outline, one order and one size everywhere. `quotation-form` and `order-form`
  each hand-rolled their own until Batch 3 and disagreed with everyone.
- Most forms render their fields from `CustomFieldsSectionRenderer`, because the
  field set is the tenant's own configuration. Hand-written fields are for what
  the DB doesn't drive.
- Dialog or page? Every form in the app branches on an `asPage` prop:
  `FormPageShell` for the page, `<Dialog>` for the modal. Follow that.

## Pattern 4 — Detail / output page

**Customer · Lead · Deal · Quotation · Order · Payment · Expense · Dispatch · Stock · Employee · Asset**

```tsx
<DetailPageLayout
  title={contact.company}
  onBack={() => router.back()}
  badges={<StatusBadge status={contact.status} />}
  meta={<><span>{contact.phone}</span><span>{contact.email}</span></>}
  actions={<Button onClick={edit}>Edit</Button>}
>
  <DetailSection title="Customer Details">
    <DetailGrid cols={2}>
      <DetailItem label="Phone" value={contact.phone} />
      <DetailItem span="full" label="Address" value={contact.address} />
    </DetailGrid>
  </DetailSection>

  <DetailSection title="Line Items">
    <LineItemsTable head={…}>…</LineItemsTable>
  </DetailSection>
</DetailPageLayout>
```

This pattern had **no implementation at all** until Batch 1. All twelve detail
pages hand-rolled their own container, back control, title size and status
treatment, and disagreed on every one of them.

- `title` is the **record's** name, not the module's.
- `meta` is identifying detail only. Anything actionable goes in `actions`.
- A record number (`ORD-0012`) is an identifier, not a title — put it in
  `badges`. Orders, dispatches and payments each floated it as a `text-2xl`
  block competing with the customer name.
- `DetailItem` renders the shared em-dash for an empty value, so the app stops
  mixing `'-'`, `'—'` and an empty cell for the same thing.
- Inline-editable fields belong together in one band near the top (see
  `leads/[id]`: Owner, Status, Collaborators), not scattered through an
  otherwise read-only page.

## Pattern 5 — Dashboards and reports

**/dashboard · the 15 report routes · Summary Reports**

```tsx
<ReportPageLayout>
  <ReportViewer config={salesReportConfig} />
</ReportPageLayout>
```

- `ReportPageLayout` keeps reports' looser rhythm (`space-y-4` against
  `PageLayout`'s `space-y-2`) because a KPI row, a filter bar and a pivot table
  need separating — and it participates in the same `fill` mechanism as every
  other page instead of `h-full`.
- KPI cards: `<MetricCard>`. Don't write another local `StatCard` — there were
  three implementations.
- Most reports are a config + `ReportViewer`. Adding a report should mean adding
  a config in `src/lib/reports/`, not a page layout.
- Reporting keeps a distinct visual hierarchy. Don't force it into the CRUD
  form layout.

## Pattern 6 — Configuration / settings

**/settings and its 25 panels**

```tsx
<SettingsPanel title="Catalogue" description="…">
  <SettingsCard>
    <SettingsRow label="Track stock" description="…">
      <Switch … />
    </SettingsRow>
  </SettingsCard>
</SettingsPanel>
```

All 25 panels are on this trio. Note `SettingsPanelHead` returns null without an
action, which is how 12 panels once had a description that never rendered.

---

## Page titles — read this before adding a route

The page title comes from a **hand-maintained route map** in
`src/components/layout/header.tsx`, rendered in the topbar. `PageHeader`'s
`title` and `subtitle` props are accepted but **render nothing** — they are
marked `@deprecated`.

Two consequences:

1. **A new route needs an entry in that map**, or it falls back to a
   title-cased first path segment.
2. The map matches by **prefix**, so `/contacts/new` resolves to the
   `/contacts` entry — the Add Customer screen is titled "Customers".

That second point is a known open decision, recorded on the prop: either
`PageHeader.title` comes back and the map is retired, or the prop and its ~31
call sites are removed and the map gains `/new` and `/[id]` entries. **Do not
add a third way.**

---

## Responsive

The shell scrolls normally below 1024px and is a locked-height, inner-scrolling
workspace above it. Sizes under test:

| | |
|---|---|
| Phones | 320×568 · 390×844 · 844×390 |
| Tablets | 768×1024 · 1024×768 |
| Desktop | **1366×768** · 1440×900 · 1920×1080 |

1366×768 matters most: it is the size the 32px density was aimed at, and it was
the one size never tested before this programme.

```bash
npm run test:responsive:desktop
```

The suite asserts no horizontal page scroll, reachable bottom controls, 44px
touch targets below 768px, and a working filter row — on Chromium, Firefox and
WebKit. Run it against a **production** build, never the dev server.

Two shell details worth knowing before you touch layout:

- `overflow-x: clip` on `html, body`, never `hidden` — `hidden` breaks
  `position: sticky`, which has already bitten the marketing site.
- A global `min-height: 2.75rem` on buttons and inputs below 768px backs up the
  per-component touch sizes. `min-height` beats a utility's `height`, so a
  page's stray `h-7` cannot shrink a tap target.

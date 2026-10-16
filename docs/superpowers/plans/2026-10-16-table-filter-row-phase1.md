# Table Filter Row — Phase 1 (Leads + Customers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a permanent filter row above the data on the Leads and Customers tables, make ad-hoc filters last only one visit, feed dropdown filters real values, and stop Manage Column silently deleting columns.

**Architecture:** The shared `DataTable` grows a second header row that owns filtering; `DataTableHeader` is reduced to a plain sortable heading. Filter values still flow through the existing `tableView.filterState`, so query building in `apply-filters.ts` is untouched. Per-visit clearing is a navigation counter in `sessionStorage`. Dropdown values come from three sources in priority order: the column's own `options`, the account's staff list, or a capped distinct-value endpoint behind a hard-coded allowlist.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase JS, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-table-filter-row-design.md`

## Global Constraints

- Web only. No mobile changes, no EAS build.
- Every change is global — it applies to all tenants, never one account.
- Push directly to `main`. No branches, no PRs. Vercel deploys `main`.
- Must work for an account with **zero `custom_fields` rows**. Three live tenants are in that state. Absence of a field row never means "off".
- Touch tap targets stay 44px on phones (`h-11 md:h-*`), matching the existing header.
- No service-role key in any new route. New endpoints query through the caller's client so RLS applies.
- Run `npm run typecheck` and `npm test` before every commit.

---

### Task 1: Ad-hoc filters last one visit

Filters currently survive navigating away and back. They should survive a refresh and a browser-tab switch, but reset when you move to a different screen inside the app. Pathname alone cannot tell those apart — leaving and returning lands on the same pathname — so count navigations.

**Files:**
- Modify: `src/lib/table-views/index.ts:139-151`
- Create: `src/components/layout/table-filter-nav-reset.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx`
- Test: `src/lib/table-views/index.test.ts`

**Interfaces:**
- Consumes: `readJson` / `writeJson` / `removeItem` already in `table-views/index.ts`.
- Produces: `bumpTableNavSeq(): void` and the changed signatures of `readScratchFilters(storageKey)` / `writeScratchFilters(storageKey, filters)` — both keep their existing signatures, only their behaviour changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/table-views/index.test.ts`:

```ts
import { bumpTableNavSeq, readScratchFilters, writeScratchFilters } from "./index";

describe("scratch filters last one visit", () => {
  beforeEach(() => sessionStorage.clear());

  it("restores filters when no navigation happened (a refresh)", () => {
    writeScratchFilters("wacrm_leads", { status: ["New"] });
    expect(readScratchFilters("wacrm_leads")).toEqual({ status: ["New"] });
  });

  it("drops filters after navigating away and back", () => {
    writeScratchFilters("wacrm_leads", { status: ["New"] });
    bumpTableNavSeq(); // to another screen
    bumpTableNavSeq(); // back again
    expect(readScratchFilters("wacrm_leads")).toBeUndefined();
  });

  it("drops filters after a single navigation too", () => {
    writeScratchFilters("wacrm_leads", { status: ["New"] });
    bumpTableNavSeq();
    expect(readScratchFilters("wacrm_leads")).toBeUndefined();
  });

  it("clears the stored entry once it is stale, so it cannot come back", () => {
    writeScratchFilters("wacrm_leads", { status: ["New"] });
    bumpTableNavSeq();
    readScratchFilters("wacrm_leads");
    expect(sessionStorage.getItem("wacrm_leads__scratch")).toBeNull();
  });

  it("keeps a second table's filters independent", () => {
    writeScratchFilters("wacrm_leads", { status: ["New"] });
    writeScratchFilters("wacrm_contacts", { city: "Surat" });
    expect(readScratchFilters("wacrm_contacts")).toEqual({ city: "Surat" });
  });
});
```

Check the exact storage-key string the suite expects by reading `scratchStorageKey` in `src/lib/table-views/index.ts`; use that spelling in the fourth test rather than the literal above if it differs.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/table-views/index.test.ts`
Expected: FAIL — `bumpTableNavSeq is not a function`.

- [ ] **Step 3: Implement the navigation counter**

Replace lines 139-151 of `src/lib/table-views/index.ts`:

```ts
const NAV_SEQ_KEY = "wacrm_table_nav_seq";

function currentNavSeq(): number {
  const parsed = readJson<{ n?: unknown }>("session", NAV_SEQ_KEY);
  return typeof parsed?.n === "number" ? parsed.n : 0;
}

/**
 * Count one move to a different screen.
 *
 * An ad-hoc filter lasts one visit: a refresh or a browser-tab switch keeps
 * it, moving to another screen inside the app clears it. Those cases cannot be
 * told apart by pathname — leaving and coming back lands on the same one — so
 * filters record the counter they were set under and are only restored while
 * it still matches.
 */
export function bumpTableNavSeq(): void {
  writeJson("session", NAV_SEQ_KEY, { n: currentNavSeq() + 1 });
}

export function readScratchFilters(storageKey: string): FilterState | undefined {
  const parsed = readJson<{ filters?: FilterState; nav?: unknown }>(
    "session",
    scratchStorageKey(storageKey),
  );
  if (!parsed || typeof parsed.filters !== "object" || parsed.filters === null) return undefined;
  if (parsed.nav !== currentNavSeq()) {
    // Stale: written before the user moved to another screen. Drop it so a
    // later read cannot resurrect it.
    removeItem("session", scratchStorageKey(storageKey));
    return undefined;
  }
  return parsed.filters;
}

export function writeScratchFilters(storageKey: string, filters: FilterState): void {
  writeJson("session", scratchStorageKey(storageKey), { filters, nav: currentNavSeq() });
}

export function clearScratchFilters(storageKey: string): void {
  removeItem("session", scratchStorageKey(storageKey));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/table-views/index.test.ts`
Expected: PASS. If other tests in that file now fail, they were asserting the old survive-navigation behaviour — update them to call `bumpTableNavSeq()` where they mean "the user moved screen", do not delete them.

- [ ] **Step 5: Add the navigation watcher**

Create `src/components/layout/table-filter-nav-reset.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { bumpTableNavSeq } from "@/lib/table-views";

/**
 * Counts screen changes so table filters last exactly one visit.
 *
 * Renders nothing. Mounted once in the dashboard shell, above every list
 * screen, so the counter has already moved by the time the next screen's
 * `useTableView` reads its stored filters.
 */
export function TableFilterNavReset() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    // The first render is arriving on a screen, not leaving one.
    if (previous.current !== null && previous.current !== pathname) {
      bumpTableNavSeq();
    }
    previous.current = pathname;
  }, [pathname]);

  return null;
}
```

- [ ] **Step 6: Mount it in the dashboard shell**

In `src/app/(dashboard)/dashboard-shell.tsx`, import `TableFilterNavReset` and render `<TableFilterNavReset />` as the first child inside the shell's outermost element, before `{children}`.

- [ ] **Step 7: Verify in the browser**

Run `preview_start` for the dev server. On Leads: set a filter, refresh — filter still there. Go to Customers, come back — filter gone. Switch to another browser tab and back — filter still there.

- [ ] **Step 8: Commit**

```bash
git add src/lib/table-views/index.ts src/lib/table-views/index.test.ts src/components/layout/table-filter-nav-reset.tsx "src/app/(dashboard)/dashboard-shell.tsx"
git commit -m "Make ad-hoc table filters last one visit"
```

---

### Task 2: Manage Column stops deleting columns

`getVisibleTableColumns` removes a base column when its field has `show_in_table === false`, so the column never reaches the Manage Column dialog and cannot be switched back on. Thirty-two fields across ten modules are in that state in the founder's account. `appendCustomFieldColumns` has the same bug for tenant-added fields.

`show_in_table: false` should mean **hidden by default but listed**. Only `is_active: false` — the field switched off in Field Settings — should remove the column. `reconcileColumns` already honours `visibleByDefault`, so nothing downstream changes.

**Files:**
- Modify: `src/lib/custom-fields.ts:367-388` and `:405-412`
- Test: `src/lib/custom-fields.table-columns.test.ts`

**Interfaces:**
- Consumes: `ColumnDef<T>` from `@/components/ui/data-table/data-table-types`, which already has `visibleByDefault?: boolean`.
- Produces: `getVisibleTableColumns` returns the same array type, now including hidden-by-default columns.

- [ ] **Step 1: Update the two existing tests and add new ones**

In `src/lib/custom-fields.table-columns.test.ts`, the tests named *"hides the company column when the COMPANY field is hidden"* and *"hides the contact-person column when the NAME field is hidden"* assert removal. They guard a real past bug — a system-key mismatch that hid the wrong column — so keep their intent and change only the assertion:

```ts
it("hides the company column by default when the COMPANY field is hidden", () => {
  const fields = [
    field({ system_key: "company", field_name: "Company Name", show_in_table: false }),
    field({ system_key: "name", field_name: "Contact Person" }),
  ];
  const cols = getVisibleTableColumns(contactColumns(), fields, []);
  // Still listed, so Manage Column can offer it back…
  expect(cols.map((c) => c.id)).toContain("name");
  // …but not shown until the user asks for it.
  expect(cols.find((c) => c.id === "name")!.visibleByDefault).toBe(false);
  // The other column is untouched — this is the system-key mismatch guard.
  expect(cols.find((c) => c.id === "contact_person")!.visibleByDefault).not.toBe(false);
});

it("hides the contact-person column by default when the NAME field is hidden", () => {
  const fields = [
    field({ system_key: "company", field_name: "Company Name" }),
    field({ system_key: "name", field_name: "Contact Person", show_in_table: false }),
  ];
  const cols = getVisibleTableColumns(contactColumns(), fields, []);
  expect(cols.find((c) => c.id === "contact_person")!.visibleByDefault).toBe(false);
  expect(cols.find((c) => c.id === "name")!.visibleByDefault).not.toBe(false);
});

it("removes a column whose field was deactivated", () => {
  const fields = [field({ system_key: "company", field_name: "Company Name", is_active: false })];
  const ids = getVisibleTableColumns(contactColumns(), fields, []).map((c) => c.id);
  expect(ids).not.toContain("name");
});

it("keeps every column when the account has no field rows at all", () => {
  const before = contactColumns().map((c) => c.id);
  const after = getVisibleTableColumns(contactColumns(), [], []).map((c) => c.id);
  expect(after).toEqual(before);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/custom-fields.table-columns.test.ts`
Expected: FAIL — the hidden columns are absent from the result, so `.find(...)` is undefined.

- [ ] **Step 3: Change the filter to a visibility flag**

Replace the filter body in `getVisibleTableColumns` (`src/lib/custom-fields.ts:367`):

```ts
  // `show_in_table: false` means hidden, NOT gone. A removed column never
  // reaches ManageColumnsDialog, so the user has no way to switch it back on —
  // which is how Leads lost Area, Pincode, WhatsApp, Address, City, State and
  // Country from Manage Column entirely. Only `is_active: false`, the field
  // switched off in Field Settings, removes the column.
  const visibleColumns = baseColumns.filter((col) => {
    if (col.id === 'actions') return true;
    const sysField = systemFieldMap.get(col.systemKey ?? col.id);
    if (sysField?.is_active === false) return false;
    if (sysField) {
      col.label = sysField.field_name || col.label;
      if (sysField.is_sortable === false) col.sortable = false;
      if (sysField.show_in_table === false) col.visibleByDefault = false;
    }
    return true;
  });
```

And in `appendCustomFieldColumns` (`src/lib/custom-fields.ts:411`) replace the early return:

```ts
    if (cf.is_active === false) return;
    const hiddenByDefault = cf.show_in_table === false;
```

then set `visibleByDefault: hiddenByDefault ? false : undefined` on the `ColumnDef` that function pushes. Read the push site before editing and add the property to the existing object literal rather than restructuring it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/custom-fields.table-columns.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Verify in the browser**

On Leads, open Manage Column. Area, Pincode, WhatsApp, Address, City, State and Country now appear in the list, unticked. The table itself looks exactly as before. Tick City, save — the column appears.

- [ ] **Step 6: Commit**

```bash
git add src/lib/custom-fields.ts src/lib/custom-fields.table-columns.test.ts
git commit -m "Stop Manage Column deleting columns that are merely hidden"
```

---

### Task 3: The permanent filter row

**Files:**
- Create: `src/components/ui/data-table/data-table-filter-row.tsx`
- Modify: `src/components/ui/data-table/data-table.tsx:276-284`
- Modify: `src/components/ui/data-table/data-table-header.tsx`

**Interfaces:**
- Consumes: `ColumnDef<T>`, `FilterState` from `./data-table-types`; `tableView.setFilter(columnId, value)`.
- Produces: `<DataTableFilterRow columns={...} filterState={...} onFilterChange={...} leadingColSpan={number} />`.

- [ ] **Step 1: Build the filter row**

Create `src/components/ui/data-table/data-table-filter-row.tsx`. Move the three `renderFilterContent` bodies out of `data-table-header.tsx` unchanged — text input, select checklist, date presets — and render them as follows.

Each cell is a `<TableCell>` in a `<TableRow>` placed inside `<TableHeader>`, directly after the heading row:

- `type: "text"` — an inline `<Input>` with a magnifier icon, `placeholder={column.label}`, debounced 300ms, and an `×` button when it has a value.
- `type: "select"` — a `<Popover>` whose trigger shows either the column label in muted text or a chip reading the single chosen option's label, or `"N selected"`, with an `×`. The content is the existing checklist, plus the value source from Task 4.
- `type: "date"` — a `<Popover>` whose trigger shows the chosen preset's label as a chip, content unchanged.
- no `type` — an empty cell.

Render `leadingColSpan` empty cells first so the row lines up with the selection checkbox and the pinned Action column.

Field Settings must still be able to switch filtering off per field. `ColumnDef`
gains `filterable?: boolean`; the filter row renders an empty cell when it is
explicitly `false`. In the same pass as Task 2, `getVisibleTableColumns` sets
`col.filterable = false` when the matching field has `is_filterable === false`.
It must be an explicit `false` check, never a truthiness check: an account with
no `custom_fields` rows has no flag at all, and absence means filterable.
Add this test to `src/lib/custom-fields.table-columns.test.ts`:

```ts
it("marks a column unfilterable only when the field says so", () => {
  const cols = getVisibleTableColumns(
    contactColumns(),
    [field({ system_key: "company", field_name: "Company", is_filterable: false })],
    [],
  );
  expect(cols.find((c) => c.id === "name")!.filterable).toBe(false);
  // No field row for this one, so it stays filterable.
  expect(cols.find((c) => c.id === "phone")!.filterable).not.toBe(false);
});
```

- [ ] **Step 2: Render it from DataTable**

In `src/components/ui/data-table/data-table.tsx`, immediately after the closing `</TableRow>` of the heading row inside `<TableHeader>`, add:

```tsx
<DataTableFilterRow
  columns={visibleColumns}
  filterState={filterState}
  onFilterChange={tableView.setFilter}
  leadingColSpan={leadingColSpan}
/>
```

`leadingColSpan` is already computed at `data-table.tsx:247`. Import `DataTableFilterRow` at the top.

- [ ] **Step 3: Reduce the heading to a heading**

In `data-table-header.tsx`, delete `renderFilterContent`, the `Popover` and the `open` state. The component becomes a `<TableHead>` containing the label plus the existing sort affordance. Keep the `isActive` highlight on the label, driven by `filterValue`, so a filtered column still reads as filtered. It keeps its current props so no call site changes.

- [ ] **Step 4: Verify in the browser**

Run `preview_start`. On Leads: the filter row sits under the headings and scrolls with them; typing in the Name box filters after a pause; the Lead Status dropdown shows a chip when chosen and clears on `×`; the row stays aligned with the checkbox and Action columns; at phone width there is no horizontal page scroll and the controls are 44px tall.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/data-table/
git commit -m "Move table filters into a permanent row above the data"
```

---

### Task 4: Real values in the dropdowns

Three sources, in priority order: the column's own `options`; the account's staff list for people columns; a capped distinct scan for everything else.

**Files:**
- Create: `src/app/api/table/column-values/route.ts`
- Create: `src/hooks/use-column-filter-options.ts`
- Modify: `src/components/ui/data-table/data-table-types.ts`
- Modify: `src/components/ui/data-table/data-table-filter-row.tsx`
- Test: `src/app/api/table/column-values/allowlist.test.ts`

**Interfaces:**
- Produces on `ColumnDef<T>`: `valueSource?: { kind: "people" } | { kind: "distinct"; module: string; column: string }`.
- Produces: `useColumnFilterOptions<T>(column: ColumnDef<T>, enabled: boolean)` returning `{ options: ColumnOption[]; loading: boolean; truncated: boolean; search: string; setSearch: (s: string) => void }`. It fetches nothing until `enabled` is true — the filter row passes the popover's open state.
- Produces: `GET /api/table/column-values?module=&column=&q=` returning `{ values: string[], truncated: boolean }`.

- [ ] **Step 1: Write the failing allowlist test**

Create `src/app/api/table/column-values/allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAllowed } from "./allowlist";

describe("column-values allowlist", () => {
  it("resolves a known module and column", () => {
    expect(resolveAllowed("lead", "city")).toEqual({ table: "leads", column: "city" });
  });

  it("refuses an unknown column on a known module", () => {
    expect(resolveAllowed("lead", "password")).toBeNull();
  });

  it("refuses an unknown module", () => {
    expect(resolveAllowed("secrets", "city")).toBeNull();
  });

  it("refuses anything that smells like injection", () => {
    expect(resolveAllowed("lead", "city; drop table leads")).toBeNull();
    expect(resolveAllowed("lead", "*")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/api/table/column-values/allowlist.test.ts`
Expected: FAIL — cannot find `./allowlist`.

- [ ] **Step 3: Write the allowlist**

Create `src/app/api/table/column-values/allowlist.ts`:

```ts
/**
 * The only module/column pairs whose distinct values may be listed.
 *
 * This map IS the security boundary: nothing a caller sends ever reaches SQL,
 * only the table and column names found here. Adding a pair is a deliberate
 * decision — never widen it to "any column of this table".
 */
const ALLOWED: Record<string, { table: string; columns: readonly string[] }> = {
  lead: { table: "leads", columns: ["city", "state", "country", "area", "company", "pincode"] },
  contact: { table: "contacts", columns: ["city", "state", "country", "area", "company", "pincode"] },
};

export function resolveAllowed(
  module: string,
  column: string,
): { table: string; column: string } | null {
  const entry = ALLOWED[module];
  if (!entry) return null;
  if (!entry.columns.includes(column)) return null;
  return { table: entry.table, column };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/api/table/column-values/allowlist.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `src/app/api/table/column-values/route.ts`. It must:

- resolve the account with `getCurrentAccount()` from `@/lib/auth/account`, the same helper the other tenant routes use, and query through `ctx.supabase` — the caller's client, so RLS applies. No `serviceClient()`.
- call `resolveAllowed(module, column)` and return `400 { error: "Unknown column" }` on null.
- select the one column, `.eq("account_id", ctx.accountId)`, `.not(column, "is", null)`, `.neq(column, "")`, `.ilike(column, \`%${q}%\`)` when `q` is non-empty, `.limit(2000)`.
- de-duplicate in JS, sort by frequency then alphabetically, take the first 100, and return `{ values, truncated: values.length === 100 }`.
- wrap in `try/catch` with `toErrorResponse(err)`, matching `src/app/api/admin/users/route.ts`.

The 2000-row cap is what keeps this cheap: it bounds the scan rather than the result. Say so in a comment.

- [ ] **Step 6: Write the hook**

Create `src/hooks/use-column-filter-options.ts`.

- `column.options` present → return them, never fetch.
- `column.valueSource.kind === "people"` → read the account's staff from `profiles` (`id, full_name`), filtered by `account_id`, cached in a module-level promise so repeated opens across columns and screens share one request for the session.
- `column.valueSource.kind === "distinct"` → fetch the route above, debounced 300ms on `search`.
- Fetch nothing until `enabled` is true; the filter row passes the popover's open state.

- [ ] **Step 7: Wire it into the filter row**

In `data-table-filter-row.tsx`, the `select` cell calls `useColumnFilterOptions(column, open)` and renders its `options`. Show a spinner while `loading`, and show the search box when `truncated`.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm test`
Then in the browser, on Leads: the Owner dropdown lists real staff names; the City dropdown lists cities present in your data. Check the Network tab shows no request until a dropdown is opened.

```bash
git add src/app/api/table/column-values/ src/hooks/use-column-filter-options.ts src/components/ui/data-table/
git commit -m "Fill table filter dropdowns with real values"
```

---

### Task 5: Point Leads and Customers at the new sources

**Files:**
- Modify: `src/app/(dashboard)/leads/page.tsx:332-460`
- Modify: `src/app/(dashboard)/contacts/page.tsx`

**Interfaces:**
- Consumes: `valueSource` from Task 4, `visibleByDefault` from Task 2.

- [ ] **Step 1: Leads**

- `lead_owner` and `lead_collaborator`: change `type: "text"` to `type: "select"` with `valueSource: { kind: "people" }`.
- `city`, `state`, `country`, `area`, `company`: change `type: "text"` to `type: "select"` with `valueSource: { kind: "distinct", module: "lead", column: "<id>" }`.
- Leave `status`, `source`, `industry`, `record_status` alone — they already carry `options`.
- Leave `name`, `whatsapp`, `phone`, `email`, `address`, `pincode` as `text`.

- [ ] **Step 2: Customers**

Read the column definitions in `src/app/(dashboard)/contacts/page.tsx` first — they are not identical to Leads. Apply the same three rules: people columns to `{ kind: "people" }`, the free-text geography and company columns to `{ kind: "distinct", module: "contact", column: "<id>" }`, anything with `options` untouched.

- [ ] **Step 3: Check the filters still reach the query**

These columns move from `text` to `select`, so their filter value changes from a string to an array. Confirm `applyTextFilter` / `applySelectFilter` are chosen correctly for each in each page's `buildQuery`: a `select` column must go through the `in` branch, not `ilike`. Fix any that are wired to the wrong helper.

- [ ] **Step 4: Verify on both screens**

Filter Leads by Owner, then by City; the row count changes and the chips show. Do the same on Customers. Clear each with `×`. Save a View with filters set, navigate away and back: the View's filters return, the ad-hoc ones do not.

- [ ] **Step 5: Commit and push**

```bash
npm run typecheck && npm test
git add "src/app/(dashboard)/leads/page.tsx" "src/app/(dashboard)/contacts/page.tsx"
git commit -m "Use real value lists in Leads and Customers filters"
git push origin main
```

---

## Phase 1 done — what to check on live

Once Vercel has deployed, on app.ozzo.co.in:

1. Leads and Customers show the filter row; the other 24 screens are unchanged.
2. Filters clear when you move screen, survive a refresh.
3. Manage Column on Leads lists the seven previously-missing fields.
4. Owner and City dropdowns show real values.
5. Saved Views still apply and still persist.

Then Phase 2 rolls Tasks 3-5 across the remaining 24 screens plus the per-screen Manage Column pass (spec Part D cause 2).

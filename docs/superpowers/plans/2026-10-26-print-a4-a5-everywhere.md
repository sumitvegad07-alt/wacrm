# A4/A5 Print for Documents and Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every transaction document prints at A4 or A5, every table can print the list you are looking at, and reports keep the A4/A5 they already have.

**Architecture:** One shared paper-size helper, lifted out of the report print route which already solves this properly, and applied to the six existing document routes. One new `/print/list` route that renders rows handed to it through `sessionStorage`, fed by the rows `DataTable` already fetches for CSV export — so list print costs nothing per screen.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS `@page`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-activity-defaults-multi-assign-print-toolbar-design.md`

## Global Constraints

- Push directly to `main`. No branches, no PRs.
- Every change applies to all tenants.
- Tests are Vitest, run with `npm test`, colocated as `src/**/*.test.ts(x)`.
- Vitest environment is `node`, **not jsdom**. Component tests use `renderToStaticMarkup` from `react-dom/server`.
- `npm run typecheck` must pass before any commit.
- `"use client"` must be the first statement in a client file; an import above it passes `tsc` and fails the build.
- Money, dates and totals on paper must match the screen exactly. Dates are account-local — convert `AT TIME ZONE` the account timezone, never `toISOString()`.
- **This plan depends on `2026-10-26-activity-defaults-and-toolbar-slot.md` being finished**, because the print entries go in the table hamburger that plan moves into the heading row.

---

### Task 1: The shared paper-size helper

`src/app/print/report/page.tsx` already reads `?size=`, sets `@page`, and steps every font down for A5. That logic becomes shared rather than copied.

**Files:**
- Create: `src/lib/print/paper.ts`
- Create: `src/lib/print/paper.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type PaperSize = "A4" | "A5"`
  - `export function parsePaperSize(raw: string | null | undefined): PaperSize` — anything other than `a5`/`A5` gives `"A4"`
  - `export function paperMetrics(size: PaperSize): { size: PaperSize; compact: boolean; margin: string; title: string; heading: string; body: string; table: string }` — every value a CSS length string

- [ ] **Step 1: Write the failing test**

Create `src/lib/print/paper.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { paperMetrics, parsePaperSize } from "./paper";

describe("parsePaperSize", () => {
  test("A4 is the default for anything unrecognised", () => {
    expect(parsePaperSize(null)).toBe("A4");
    expect(parsePaperSize(undefined)).toBe("A4");
    expect(parsePaperSize("")).toBe("A4");
    expect(parsePaperSize("letter")).toBe("A4");
    expect(parsePaperSize("a4")).toBe("A4");
  });

  test("A5 is recognised whatever the case", () => {
    expect(parsePaperSize("a5")).toBe("A5");
    expect(parsePaperSize("A5")).toBe("A5");
  });
});

describe("paperMetrics", () => {
  test("A4 is not compact and keeps the roomier margin", () => {
    const m = paperMetrics("A4");
    expect(m.compact).toBe(false);
    expect(m.margin).toBe("16mm");
  });

  test("A5 is compact with a tighter margin", () => {
    const m = paperMetrics("A5");
    expect(m.compact).toBe(true);
    expect(m.margin).toBe("10mm");
  });

  // A5 is half an A4 sheet. If the type did not come down with it the same
  // table would run off the page, which is the whole reason this helper exists.
  test("every A5 measurement is smaller than its A4 counterpart", () => {
    const a4 = paperMetrics("A4");
    const a5 = paperMetrics("A5");
    for (const key of ["title", "heading", "body", "table"] as const) {
      expect(parseFloat(a5[key])).toBeLessThan(parseFloat(a4[key]));
    }
  });

  test("measurements carry CSS units", () => {
    const m = paperMetrics("A4");
    for (const key of ["title", "heading", "body", "table"] as const) {
      expect(m[key]).toMatch(/^[\d.]+px$/);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/print/paper.test.ts`
Expected: FAIL — cannot resolve `./paper`.

- [ ] **Step 3: Write the helper**

Create `src/lib/print/paper.ts`:

```ts
export type PaperSize = "A4" | "A5";

/**
 * Read a paper size off a query string. Anything unrecognised is A4, because
 * a print that silently comes out the wrong size is worse than one that
 * ignores a typo.
 */
export function parsePaperSize(raw: string | null | undefined): PaperSize {
  return String(raw ?? "").toLowerCase() === "a5" ? "A5" : "A4";
}

/**
 * The type scale for a sheet.
 *
 * A5 is half an A4, so the same table has to come down a size to keep its
 * columns on the page. These numbers are the ones `/print/report` has been
 * using in production; they are lifted here rather than re-derived so paper
 * output stays identical to what the founder has already approved.
 */
export function paperMetrics(size: PaperSize) {
  const compact = size === "A5";
  return {
    size,
    compact,
    margin: compact ? "10mm" : "16mm",
    title: compact ? "16px" : "22px",
    heading: compact ? "12px" : "15px",
    body: compact ? "9px" : "11px",
    table: compact ? "8.5px" : "11px",
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/lib/print/paper.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Move the report route onto the helper**

In `src/app/print/report/page.tsx`, replace:

```ts
  const pageSize = params.get('size') === 'a5' ? 'A5' : 'A4';
  const compact = pageSize === 'A5';
```

with:

```ts
  const paper = parsePaperSize(params.get('size'));
  const { size: pageSize, compact } = paperMetrics(paper);
```

and add the import. Leave every other line of that file alone — its inline
`${compact ? ... : ...}` expressions already produce the right CSS and this
task is not a rewrite of a working print route.

- [ ] **Step 6: Confirm the report print is unchanged**

Run: `npm run typecheck`
Expected: no errors.

Open `/print/report?module=sales&dims=customer&measures=order_count,net_amount` and the same URL with `&size=a5`. Both must render exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/lib/print/paper.ts src/lib/print/paper.test.ts src/app/print/report/page.tsx
git commit -m "Share the A4/A5 paper scale the report print already used"
```

---

### Task 2: A5 on the six existing document routes

**Files:**
- Modify: `src/app/print/order/[id]/page.tsx:121`
- Modify: `src/app/print/quotation/[id]/page.tsx:113`
- Modify: `src/app/print/dispatch/[id]/page.tsx:108`
- Modify: `src/app/print/payment/[id]/page.tsx:102`
- Modify: `src/app/print/invoice/[id]/` (the page file beside `download-button.tsx`)
- Leave alone: `src/app/print/proposal/[id]/page.tsx`

**Interfaces:**
- Consumes: `parsePaperSize`, `paperMetrics` from Task 1.
- Produces: all five routes accept `?size=a4|a5`.

- [ ] **Step 1: Read the proposal route's comment before touching anything**

`src/app/print/proposal/[id]/page.tsx` carries a comment saying it has no
`@page` override on purpose: its own stylesheet sets `size:A4; margin:0`, and
that is what lets the dark cover bleed to the paper edge. **The proposal route
is excluded from this task.** Confirm the comment is still there, then move on.

- [ ] **Step 2: Change each of the five routes**

For each of order, quotation, dispatch, payment and invoice, replace the
hard-coded rule:

```css
          @page { margin: 10mm; size: A4 portrait; }
```

with a value read from the query string. In each page component, read the size
near the top:

```ts
  const paper = parsePaperSize(searchParams?.size);
  const { size: pageSize, margin } = paperMetrics(paper);
```

and change the rule to:

```css
          @page { margin: ${margin}; size: ${pageSize} portrait; }
```

These are server components taking `searchParams`; if one is a client
component, read the value with `useSearchParams()` instead and keep
`"use client"` as the file's first statement.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Check both sizes render**

For a real order id, open `/print/order/<id>` and `/print/order/<id>?size=a5`,
then use the browser's print preview on each.

Confirm: A4 looks exactly as it does today, and A5 fits the sheet without
columns running off the right edge. Repeat for quotation, dispatch, payment
and invoice.

If an A5 table overflows, reduce that document's table font using
`paperMetrics(...).table` rather than inventing a new number.

- [ ] **Step 5: Commit and push**

```bash
git add src/app/print
git commit -m "Give the five transaction documents an A5 option"
git push origin main
```

---

### Task 3: A4/A5 menus, and the missing Payment button

**Files:**
- Create: `src/components/print/print-size-menu.tsx`
- Modify: `src/app/(dashboard)/orders/[id]/page.tsx:227`
- Modify: `src/app/(dashboard)/quotations/[id]/page.tsx:243`
- Modify: `src/app/(dashboard)/dispatches/[id]/page.tsx:115`
- Modify: the tenant payment detail page under `src/app/(dashboard)/payments/`

**Interfaces:**
- Consumes: Task 2's routes.
- Produces: `export function PrintSizeMenu({ href, label }: { href: string; label?: string }): JSX.Element` — `href` is the print route without a `size` parameter.

- [ ] **Step 1: Write the component**

Create `src/components/print/print-size-menu.tsx`:

```tsx
"use client";

import { Printer } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * Print button with a paper choice behind it.
 *
 * Opening a new tab per size rather than printing in place keeps the browser's
 * own print preview in the loop, which is where people pick their printer and
 * save as PDF.
 */
export function PrintSizeMenu({ href, label = "Print" }: { href: string; label?: string }) {
  const open = (size: "a4" | "a5") => {
    const url = href.includes("?") ? `${href}&size=${size}` : `${href}?size=${size}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Printer className="size-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      {/* No DropdownMenuLabel here: this menu is Base UI, and a Label outside a
          Group throws and takes the page down. */}
      <DropdownMenuContent align="end" className="w-40 text-xs">
        <DropdownMenuItem onClick={() => open("a4")} className="cursor-pointer">
          Print on A4
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => open("a5")} className="cursor-pointer">
          Print on A5
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Swap the three existing buttons**

In the order, quotation and dispatch detail pages, replace each
`window.open('/print/...')` button with:

```tsx
<PrintSizeMenu href={`/print/order/${id}`} />
```

using the right route and id per page. Keep each page's existing button
placement; only the control changes.

- [ ] **Step 3: Add the missing Payment print button**

`/print/payment/[id]` exists but nothing in the tenant app links to it — only
the superadmin side does. Add to the tenant payment detail page, in the same
action row as its other buttons:

```tsx
<PrintSizeMenu href={`/print/payment/${id}`} label="Receipt" />
```

- [ ] **Step 4: Typecheck and check in the browser**

Run: `npm run typecheck`
Expected: no errors.

Open an order, a quotation, a dispatch and a payment. Each shows a Print
control; each offers A4 and A5; each opens the right document.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/print "src/app/(dashboard)"
git commit -m "Offer A4/A5 on document print, and surface the payment receipt"
git push origin main
```

---

### Task 4: Expense and Leave document print

**Files:**
- Create: `src/app/print/expense/[id]/page.tsx`
- Create: `src/app/print/leave/[id]/page.tsx`
- Modify: `src/app/(dashboard)/expenses/[id]/page.tsx`
- Modify: the leave detail view under `src/app/(dashboard)/location-tracking/leaves/`

**Interfaces:**
- Consumes: `parsePaperSize`, `paperMetrics` (Task 1), `PrintSizeMenu` (Task 3).
- Produces: `/print/expense/[id]` and `/print/leave/[id]`, both accepting `?size=a4|a5`.

- [ ] **Step 1: Read an existing document route end to end**

Read `src/app/print/payment/[id]/page.tsx` in full before writing anything. It
is the closest analogue — a small single-record voucher — and the new routes
follow its structure, its account-header block and its data fetching exactly.
Do not invent a second house style for printed documents.

- [ ] **Step 2: Build the expense route**

Create `src/app/print/expense/[id]/page.tsx` modelled on the payment route.
It shows: the account header, the expense number and date, the employee, the
category, the description, the amount, the approval status with approver and
approval date, and the odometer reading where the expense has one.

Dates render account-local, converted `AT TIME ZONE` the account's timezone.
Never `toISOString()`.

If an expense has a proof image, it is **not** embedded — a photo can be
several megabytes and would make the sheet unprintable. Print a line saying a
proof is attached instead.

- [ ] **Step 3: Build the leave route**

Create `src/app/print/leave/[id]/page.tsx` the same way. It shows: the account
header, the employee, leave type, from and to dates, the number of days, the
reason, the status, and the approver with the approval date.

The working-week calculation already lives in the leave module — import it
rather than recomputing days here. The hardcoded Mon–Fri week was a bug once
already; do not reintroduce it.

- [ ] **Step 4: Add the buttons**

Add `<PrintSizeMenu href={`/print/expense/${id}`} />` to the expense detail
page and `<PrintSizeMenu href={`/print/leave/${id}`} />` to the leave detail
view, each in that page's existing action row.

- [ ] **Step 5: Typecheck and check in the browser**

Run: `npm run typecheck`
Expected: no errors.

Open a real expense and a real leave. Print both at A4 and A5. Confirm the
amount, the dates and the status match the screen exactly.

- [ ] **Step 6: Commit and push**

```bash
git add src/app/print/expense src/app/print/leave "src/app/(dashboard)"
git commit -m "Print an expense voucher and a leave record"
git push origin main
```

---

### Task 5: Print the list on screen

**Files:**
- Create: `src/lib/print/list-payload.ts`
- Create: `src/lib/print/list-payload.test.ts`
- Create: `src/app/print/list/page.tsx`
- Modify: `src/components/ui/data-table/data-table.tsx`

**Interfaces:**
- Consumes: `parsePaperSize`, `paperMetrics` (Task 1).
- Produces:
  - `export interface ListPrintPayload { title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; total: number; truncated: boolean; printedAt: string }`
  - `export function stashListPayload(payload: ListPrintPayload): string` — returns a key
  - `export function readListPayload(key: string): ListPrintPayload | null`
  - `export function formatCell(value: unknown): string`

- [ ] **Step 1: Write the failing test**

The rows are handed over through `sessionStorage` rather than the URL: a
thousand-row list cannot fit in a query string, and re-querying in the print
tab would silently print a different set of rows than the one on screen.

Create `src/lib/print/list-payload.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatCell, readListPayload, stashListPayload } from "./list-payload";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const payload = {
  title: "Orders",
  columns: [{ key: "no", label: "Order #" }],
  rows: [{ no: "SO-1" }],
  total: 1,
  truncated: false,
  printedAt: "2026-10-26T10:00:00.000Z",
};

describe("list payload hand-off", () => {
  test("a stashed payload reads back identically", () => {
    const key = stashListPayload(payload);
    expect(readListPayload(key)).toEqual(payload);
  });

  test("each stash gets its own key, so two print tabs cannot collide", () => {
    expect(stashListPayload(payload)).not.toBe(stashListPayload(payload));
  });

  test("an unknown key gives null rather than throwing", () => {
    expect(readListPayload("nope")).toBeNull();
  });

  test("corrupt stored JSON gives null rather than throwing", () => {
    store.set("wacrm_print_list_x", "{not json");
    expect(readListPayload("wacrm_print_list_x")).toBeNull();
  });
});

describe("formatCell", () => {
  // Paper has no empty-cell affordance, so a blank must look deliberate.
  test("empty values print as a dash", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(undefined)).toBe("—");
    expect(formatCell("")).toBe("—");
  });

  test("numbers and booleans print readably", () => {
    expect(formatCell(0)).toBe("0");
    expect(formatCell(1250.5)).toBe("1250.5");
    expect(formatCell(true)).toBe("Yes");
    expect(formatCell(false)).toBe("No");
  });

  test("objects print as something, never [object Object]", () => {
    expect(formatCell({ name: "Priya" })).not.toContain("[object");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/print/list-payload.test.ts`
Expected: FAIL — cannot resolve `./list-payload`.

- [ ] **Step 3: Write the module**

Create `src/lib/print/list-payload.ts`:

```ts
export interface ListPrintPayload {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  total: number;
  /** True when the row fetch hit its cap, so the sheet says so. */
  truncated: boolean;
  printedAt: string;
}

const PREFIX = "wacrm_print_list_";

/**
 * Hand a list to the print tab.
 *
 * sessionStorage rather than the URL: a thousand-row list does not fit in a
 * query string, and re-querying in the print tab would print a different set
 * of rows than the one the user is looking at — the single thing a printed
 * list must never do.
 */
export function stashListPayload(payload: ListPrintPayload): string {
  const key = `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota, or storage blocked. The print tab shows its empty state.
  }
  return key;
}

/** Read it back once, in the print tab. Never throws. */
export function readListPayload(key: string): ListPrintPayload | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ListPrintPayload;
  } catch {
    return null;
  }
}

/** One cell, as it should look on paper. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const named = o.name ?? o.full_name ?? o.title ?? o.label;
    return named === undefined ? JSON.stringify(value) : String(named);
  }
  return String(value);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/lib/print/list-payload.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Build the print route**

Create `src/app/print/list/page.tsx`, a client component reading `?key=` and
`?size=`. Model its header, table and footer on `src/app/print/report/page.tsx`
— same account header, same table rules, same `@page` block built from
`paperMetrics`.

It must handle three states honestly:
- **No key, or nothing stored** — "This print link has expired. Print again from the list." An empty table pretending to be a real result is worse than a message.
- **`truncated: true`** — a line under the title saying only the first N rows are shown and the filter should be narrowed.
- **Rows** — the table, the row count, and the printed-at timestamp in the footer.

Cells render through `formatCell`.

- [ ] **Step 6: Wire the hamburger**

In `src/components/ui/data-table/data-table.tsx`, add a handler beside
`handleExport`:

```ts
  const handlePrintList = async (size: "a4" | "a5") => {
    let rows: Record<string, unknown>[] = safeData as Record<string, unknown>[];
    let truncated = false;

    if (serverPagination) {
      // Same rule as Export CSV: without exportAll the only rows available are
      // the page on screen, which is never what "print the list" means — so
      // the entry is not offered at all. See canPrintList below.
      if (!serverPagination.exportAll) return;
      const result = await serverPagination.exportAll();
      rows = result.rows as Record<string, unknown>[];
      truncated = result.truncated;
    }

    const key = stashListPayload({
      title: document.title,
      columns: visibleColumns.map((c) => ({ key: String(c.key), label: String(c.header ?? c.key) })),
      rows,
      total: rows.length,
      truncated,
      printedAt: new Date().toISOString(),
    });

    window.open(`/print/list?key=${key}&size=${size}`, "_blank", "noopener");
  };
```

Check `visibleColumns`' actual element shape before writing that `.map` — read
the type in the file and match it rather than assuming `key` and `header`.

Add the gate beside the existing `canExport`:

```ts
  const canPrintList = !serverPagination || Boolean(serverPagination.exportAll);
```

Add the two entries to `toolbarControls`' dropdown, below Export CSV:

```tsx
          {canPrintList && <DropdownMenuSeparator />}
          {canPrintList && (
            <DropdownMenuItem onClick={() => handlePrintList("a4")} className="cursor-pointer gap-2">
              <Printer className="size-3.5" />
              Print list (A4)
            </DropdownMenuItem>
          )}
          {canPrintList && (
            <DropdownMenuItem onClick={() => handlePrintList("a5")} className="cursor-pointer gap-2">
              <Printer className="size-3.5" />
              Print list (A5)
            </DropdownMenuItem>
          )}
```

Import `Printer` from `lucide-react` and the two payload helpers.

- [ ] **Step 7: Typecheck and test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Check it in the browser**

On `/orders`: filter to one customer, hide a column through Manage Column,
then print the list at A4.

Confirm:
1. The sheet shows only the filtered rows.
2. The hidden column is absent.
3. The row count matches the screen.
4. A5 fits without columns running off the edge.
5. On a list of 50+ rows, every row is on the sheet — not just the 20 on screen.

Repeat on `/contacts` and `/products`.

- [ ] **Step 9: Commit and push**

```bash
git add src/lib/print src/app/print/list src/components/ui/data-table/data-table.tsx
git commit -m "Print the list you are looking at, at A4 or A5"
git push origin main
```

---

### Task 6: Verify the reports that already print

Reports were built with A4/A5 and this task is **verification, not construction**. Fix what is broken; rebuild nothing.

**Files:**
- Modify only where a fault is found: `src/components/reports/report-viewer.tsx`, `src/app/print/report/page.tsx`

**Interfaces:**
- Consumes: Task 1's helper, already wired into the report route.
- Produces: nothing.

- [ ] **Step 1: List the reports**

Read `src/lib/reports/registry.ts` and write down every report module it
registers, plus the two summary reports (Product Summary, Customer
Outstanding).

- [ ] **Step 2: Print each one, both sizes**

For each report: run it with a real filter, then print at A4 and at A5.

For each, confirm:
1. The print tab shows the same rows as the screen.
2. The filter chips on the sheet say what was actually filtered.
3. Subtotals and the grand total match the screen.
4. A5 fits without columns running off the edge.
5. The account name and report title are in the header.

- [ ] **Step 3: Record the results**

Write a short table — report, A4 result, A5 result — into the task report.
Name faults precisely; do not fix them in this step.

- [ ] **Step 4: Fix only what is broken**

For each fault, make the smallest change that corrects it. A column running
off an A5 sheet is a font-size fix through `paperMetrics`, not a rewrite.

If a report's numbers disagree between screen and paper, **stop and report
it** — that is a data bug, not a print bug, and it is out of this plan's scope.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/components/reports src/app/print/report
git commit -m "Fix what report print got wrong at A5"
git push origin main
```

Skip the commit entirely if nothing needed fixing, and say so in the report.

- [ ] **Step 6: Report**

Give the commit hashes and the per-report table. State plainly which reports
were already correct and which needed a fix.

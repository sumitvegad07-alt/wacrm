# My Activity Defaults and the Table Toolbar Slot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Activity opens on today's tasks for the signed-in user, and the table toolbar line disappears from every module while its controls survive in the page heading row.

**Architecture:** Two unrelated changes that ship together because both are small and both are immediately visible. The My Activity work extracts the page's inline period-filter logic into a pure, testable module and changes two `useState` defaults. The toolbar work introduces a context-held DOM slot: `PageHeader` renders the container, `DataTable` portals its controls into it, and neither component's consumers change.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind, Supabase JS client, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-activity-defaults-multi-assign-print-toolbar-design.md`

## Global Constraints

- Push directly to `main`. No branches, no PRs — Vercel deploys `main`, so branched work never reaches live.
- Every change applies to all tenants. Never scope to one account unless told so.
- Tests are Vitest, run with `npm test`. Files are colocated as `src/**/*.test.ts(x)`.
- The Vitest environment is `node`, **not jsdom**. Component tests render with `renderToStaticMarkup` from `react-dom/server` and assert against the markup string. Follow `src/components/settings/outstanding-settings.test.tsx`.
- `npm run typecheck` must pass before any commit.
- An `import` placed above `"use client"` passes `tsc` and fails the production build. Keep `"use client"` the first statement in the file.
- `DropdownMenu` here is Base UI, not Radix. `DropdownMenuLabel` outside a `DropdownMenuGroup` throws and takes the page down.
- `tasks.assigned_user_id` holds a **`profiles.id`**, never an auth user id.

---

### Task 1: Pure period-filter module for My Activity

Extracts the period logic currently inlined in `fetchTasks` so it can be tested, then changes `Today` to include undated tasks.

**Files:**
- Create: `src/lib/tasks/period-filter.ts`
- Create: `src/lib/tasks/period-filter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type TaskPeriod = "All" | "Overdue" | "Today" | "Tomorrow" | "This Week" | "This Month" | "Custom Range"`
  - `export const DEFAULT_PERIOD: TaskPeriod`
  - `export function matchesPeriod(dueDate: string | null | undefined, period: TaskPeriod, customStart?: string, customEnd?: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tasks/period-filter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { DEFAULT_PERIOD, matchesPeriod } from "./period-filter";

const TODAY = new Date();
const iso = (d: Date) => d.toISOString().split("T")[0];
const shift = (days: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return iso(d);
};

describe("matchesPeriod", () => {
  test("All keeps everything, dated or not", () => {
    expect(matchesPeriod(shift(-30), "All")).toBe(true);
    expect(matchesPeriod(null, "All")).toBe(true);
  });

  test("Today keeps today", () => {
    expect(matchesPeriod(shift(0), "Today")).toBe(true);
  });

  // The whole point of the change: an unscheduled task is not a future
  // task, and it must not vanish from the screen named after today.
  test("Today also keeps tasks with no due date", () => {
    expect(matchesPeriod(null, "Today")).toBe(true);
    expect(matchesPeriod(undefined, "Today")).toBe(true);
  });

  test("Today drops other days", () => {
    expect(matchesPeriod(shift(-1), "Today")).toBe(false);
    expect(matchesPeriod(shift(1), "Today")).toBe(false);
  });

  // Picking a range by hand means naming dates on purpose, so undated
  // tasks stay out of it.
  test("a hand-picked period still drops undated tasks", () => {
    expect(matchesPeriod(null, "Tomorrow")).toBe(false);
    expect(matchesPeriod(null, "This Week")).toBe(false);
    expect(matchesPeriod(null, "Overdue")).toBe(false);
  });

  test("Tomorrow keeps tomorrow only", () => {
    expect(matchesPeriod(shift(1), "Tomorrow")).toBe(true);
    expect(matchesPeriod(shift(0), "Tomorrow")).toBe(false);
  });

  test("Overdue keeps the past only", () => {
    expect(matchesPeriod(shift(-1), "Overdue")).toBe(true);
    expect(matchesPeriod(shift(0), "Overdue")).toBe(false);
  });

  test("Custom Range honours both ends inclusively", () => {
    expect(matchesPeriod(shift(2), "Custom Range", shift(1), shift(3))).toBe(true);
    expect(matchesPeriod(shift(5), "Custom Range", shift(1), shift(3))).toBe(false);
    expect(matchesPeriod(shift(3), "Custom Range", shift(1), shift(3))).toBe(true);
  });

  test("Custom Range with no dates chosen keeps dated rows", () => {
    expect(matchesPeriod(shift(99), "Custom Range")).toBe(true);
  });

  test("the page default is Today", () => {
    expect(DEFAULT_PERIOD).toBe("Today");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/tasks/period-filter.test.ts`
Expected: FAIL — cannot resolve `./period-filter`.

- [ ] **Step 3: Write the module**

Create `src/lib/tasks/period-filter.ts`:

```ts
import {
  isBefore,
  isThisMonth,
  isThisWeek,
  isToday,
  isTomorrow,
  startOfToday,
} from "date-fns";

export type TaskPeriod =
  | "All"
  | "Overdue"
  | "Today"
  | "Tomorrow"
  | "This Week"
  | "This Month"
  | "Custom Range";

/**
 * My Activity opens on today rather than on everything, so a rep with four
 * hundred finished tasks behind them sees the handful that matter now.
 */
export const DEFAULT_PERIOD: TaskPeriod = "Today";

/**
 * Does a task's due date fall inside the chosen period?
 *
 * `Today` is the only period that keeps undated tasks. A task with no due
 * date is not a future task, it is an unscheduled one, and dropping it would
 * make it invisible on the screen the app opens to. Every other period is a
 * date range the user named on purpose, so an undated task is correctly
 * outside it.
 */
export function matchesPeriod(
  dueDate: string | null | undefined,
  period: TaskPeriod,
  customStart?: string,
  customEnd?: string,
): boolean {
  if (period === "All") return true;
  if (!dueDate) return period === "Today";

  const taskDate = new Date(dueDate);

  switch (period) {
    case "Overdue":
      return isBefore(taskDate, startOfToday());
    case "Today":
      return isToday(taskDate);
    case "Tomorrow":
      return isTomorrow(taskDate);
    case "This Week":
      return isThisWeek(taskDate);
    case "This Month":
      return isThisMonth(taskDate);
    case "Custom Range": {
      if (!customStart || !customEnd) return true;
      const start = new Date(customStart);
      const end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
      return taskDate >= start && taskDate <= end;
    }
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/lib/tasks/period-filter.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/period-filter.ts src/lib/tasks/period-filter.test.ts
git commit -m "Pull My Activity's period filter out into a tested module"
```

---

### Task 2: My Activity opens on today, on your own tasks

**Files:**
- Modify: `src/app/(dashboard)/follow-ups/page.tsx`

**Interfaces:**
- Consumes: `DEFAULT_PERIOD`, `matchesPeriod`, `TaskPeriod` from Task 1.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Point the page at the new module**

In `src/app/(dashboard)/follow-ups/page.tsx`, add to the imports (below `"use client"`, never above it):

```ts
import { DEFAULT_PERIOD, matchesPeriod, type TaskPeriod } from "@/lib/tasks/period-filter";
```

Remove the now-unused `date-fns` import line:

```ts
import { isBefore, startOfToday, isToday, isTomorrow, isThisWeek, isThisMonth } from "date-fns";
```

- [ ] **Step 2: Change the two defaults and pull the profile in**

`useAuth()` already returns the signed-in user's profile row and a flag for
whether it has settled. `profile.id` is a `profiles.id`, which is exactly what
`tasks.assigned_user_id` holds.

Change:

```ts
  const { accountId } = useAuth();
```

to:

```ts
  const { accountId, profile, profileLoading } = useAuth();
```

Change the two filter defaults:

```ts
  const [assignTo, setAssignTo] = useState("all");
  const [period, setPeriod] = useState("All");
```

to:

```ts
  // Opens on you, not the whole team — the screen is called My Activity.
  // "all" until the profile row settles, then replaced by the effect below.
  const [assignTo, setAssignTo] = useState("all");
  const [period, setPeriod] = useState<TaskPeriod>(DEFAULT_PERIOD);
```

- [ ] **Step 3: Default the assignee once the profile settles**

Add this effect directly below the existing `loadInitialData` effect:

```ts
  // Default the assignee filter to the signed-in user, once — after that the
  // user owns the control and a re-render must not drag it back.
  //
  // A user with no profile row falls through to "all" rather than showing an
  // empty screen with no explanation.
  const defaultedAssignee = useRef(false);
  useEffect(() => {
    if (profileLoading || defaultedAssignee.current) return;
    defaultedAssignee.current = true;
    if (profile?.id) setAssignTo(profile.id);
  }, [profileLoading, profile?.id]);
```

Add `useRef` to the React import at the top of the file:

```ts
import { useState, useEffect, useRef } from "react";
```

- [ ] **Step 4: Hold the first fetch until the profile is known**

Without this the page fires once with `assignTo === "all"` and flashes the
whole team's tasks before snapping to one person.

Change:

```ts
  useEffect(() => {
    if (accountId) {
      fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, assignTo, activityStatus, period, activityType, searchQuery, customStart, customEnd, priorityFilter]);
```

to:

```ts
  useEffect(() => {
    // Waiting on the profile matters: firing before it settles would show the
    // whole team for a moment and then snap to one person.
    if (accountId && !profileLoading) {
      fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, profileLoading, assignTo, activityStatus, period, activityType, searchQuery, customStart, customEnd, priorityFilter]);
```

- [ ] **Step 5: Use the shared period filter**

Inside `fetchTasks`, replace the whole `if (period !== "All") { ... }` block
— from `// Apply period filtering manually` down to its closing brace — with:

```ts
      filteredData = filteredData.filter((task) =>
        matchesPeriod(task.due_date, period, customStart, customEnd),
      );
```

- [ ] **Step 6: Keep the Select typed**

Find the period `<Select>` and change its handler so it stays a `TaskPeriod`:

```tsx
            <Select value={period} onValueChange={(val) => setPeriod((val || DEFAULT_PERIOD) as TaskPeriod)}>
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors. The `date-fns` import must be gone — a leftover unused import fails lint.

- [ ] **Step 8: Check it in the browser**

Start the dev server through the preview tool (never `npm run dev` in a shell) and open `/follow-ups`.

Confirm, in order:
1. Period reads **Today** on load.
2. Assign-to reads **your own name**, not "All".
3. A task with no due date is still listed.
4. Switching Period to **Tomorrow** hides undated tasks.
5. Switching Assign-to to **All** shows the team's tasks.

- [ ] **Step 9: Commit and push**

```bash
git add "src/app/(dashboard)/follow-ups/page.tsx"
git commit -m "My Activity opens on today, on your own tasks"
git push origin main
```

---

### Task 3: The toolbar slot context

A tiny provider holding one DOM node and one flag. Separate from both consumers so neither has to own the other.

**Files:**
- Create: `src/components/layout/table-toolbar-slot.tsx`
- Create: `src/components/layout/table-toolbar-slot.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function TableToolbarSlotProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `export function useTableToolbarSlot(): { node: HTMLElement | null; setNode: (el: HTMLElement | null) => void; claimed: boolean; claim: () => void; release: () => void }`
  - `export function shouldRenderHeader(args: { breadcrumbs: boolean; badge: boolean; actions: boolean; claimed: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

Only `shouldRenderHeader` is unit-tested. It is the decision that, got wrong,
silently loses a table's controls — the same failure as the settings panels
whose descriptions never rendered because their head component returned null.
The portal itself is client-only and is checked in the browser in Task 6.

Create `src/components/layout/table-toolbar-slot.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { shouldRenderHeader } from "./table-toolbar-slot";

const base = { breadcrumbs: false, badge: false, actions: false, claimed: false };

describe("shouldRenderHeader", () => {
  test("stays null when there is nothing at all to show", () => {
    expect(shouldRenderHeader(base)).toBe(false);
  });

  test("renders for its own content, as it always has", () => {
    expect(shouldRenderHeader({ ...base, actions: true })).toBe(true);
    expect(shouldRenderHeader({ ...base, badge: true })).toBe(true);
    expect(shouldRenderHeader({ ...base, breadcrumbs: true })).toBe(true);
  });

  // The trap. A page whose header has no content of its own still needs to
  // render once a table has claimed the slot, or the table's views, count
  // and menu have nowhere to go and disappear.
  test("renders when a table has claimed the slot, even with no content", () => {
    expect(shouldRenderHeader({ ...base, claimed: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/components/layout/table-toolbar-slot.test.tsx`
Expected: FAIL — cannot resolve `./table-toolbar-slot`.

- [ ] **Step 3: Write the provider**

Create `src/components/layout/table-toolbar-slot.tsx`:

```tsx
"use client";

import * as React from "react";

/**
 * The slot that lets a DataTable put its controls in the page's heading row.
 *
 * The table's toolbar used to be a strip of its own above the grid. It cost a
 * line of vertical space on all 26 data screens to hold four controls, and
 * once every column grew its own filter the strip stopped earning it. Rather
 * than rewire 29 page files to pass the controls up by hand — slow, and two
 * components that can drift apart — the table renders them straight into the
 * header through a portal.
 *
 * `claimed` exists because PageHeader returns null when it has nothing of its
 * own to show. On such a page the portal would have nowhere to go and the
 * controls would vanish silently. Claiming forces the header to render.
 */
interface TableToolbarSlot {
  node: HTMLElement | null;
  setNode: (el: HTMLElement | null) => void;
  claimed: boolean;
  claim: () => void;
  release: () => void;
}

const Ctx = React.createContext<TableToolbarSlot | null>(null);

export function TableToolbarSlotProvider({ children }: { children: React.ReactNode }) {
  // State, not a ref: the table must re-render once the node exists, and the
  // header must re-render once the slot is claimed.
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [claims, setClaims] = React.useState(0);

  const claim = React.useCallback(() => setClaims((n) => n + 1), []);
  const release = React.useCallback(() => setClaims((n) => Math.max(0, n - 1)), []);

  const value = React.useMemo(
    () => ({ node, setNode, claimed: claims > 0, claim, release }),
    [node, claims, claim, release],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Null-safe on purpose. A table rendered outside the dashboard shell — a
 * print route, a test — gets an inert slot and falls back to its own inline
 * toolbar rather than throwing.
 */
export function useTableToolbarSlot(): TableToolbarSlot {
  const ctx = React.useContext(Ctx);
  const noop = React.useCallback(() => {}, []);
  return ctx ?? { node: null, setNode: noop, claimed: false, claim: noop, release: noop };
}

/** Whether PageHeader renders at all. See the `claimed` note above. */
export function shouldRenderHeader(args: {
  breadcrumbs: boolean;
  badge: boolean;
  actions: boolean;
  claimed: boolean;
}): boolean {
  return args.breadcrumbs || args.badge || args.actions || args.claimed;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/components/layout/table-toolbar-slot.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Mount the provider in the dashboard shell**

In `src/app/(dashboard)/dashboard-shell.tsx`, add the import beside the other
layout imports:

```ts
import { TableToolbarSlotProvider } from "@/components/layout/table-toolbar-slot";
```

Wrap the shell's rendered tree in `<TableToolbarSlotProvider>`. It must sit
**outside** the element that renders `children`, so both the page's
`PageHeader` and its `DataTable` are inside the same provider. Put it
immediately inside `KeyboardShortcutsProvider`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/table-toolbar-slot.tsx src/components/layout/table-toolbar-slot.test.tsx "src/app/(dashboard)/dashboard-shell.tsx"
git commit -m "Add the table toolbar slot the page heading row will host"
```

---

### Task 4: PageHeader hosts the slot

**Files:**
- Modify: `src/components/shared/page-header.tsx`

**Interfaces:**
- Consumes: `useTableToolbarSlot`, `shouldRenderHeader` from Task 3.
- Produces: no new exports. `PageHeader`'s props are unchanged, so no page file changes.

- [ ] **Step 1: Import the slot**

In `src/components/shared/page-header.tsx`, below the existing imports:

```ts
import { shouldRenderHeader, useTableToolbarSlot } from "@/components/layout/table-toolbar-slot";
```

- [ ] **Step 2: Replace the null-return with the shared decision**

Change:

```tsx
  if (!breadcrumbs && !badge && !actions) {
    return null;
  }
```

to:

```tsx
  const slot = useTableToolbarSlot();

  // A header with nothing of its own still renders once a table has claimed
  // the slot — otherwise the table's controls would have nowhere to portal to
  // and would disappear without a trace.
  if (
    !shouldRenderHeader({
      breadcrumbs: Boolean(breadcrumbs),
      badge: Boolean(badge),
      actions: Boolean(actions),
      claimed: slot.claimed,
    })
  ) {
    return null;
  }
```

Hooks must not run conditionally, so `useTableToolbarSlot()` has to sit above
the early return and below the destructured props.

- [ ] **Step 3: Render the container**

Change the actions block:

```tsx
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
```

to:

```tsx
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {/* The table's own controls land here. The ref callback is what tells
            the table its target exists; leaving the div mounted unconditionally
            keeps that target stable across the page's own re-renders. */}
        <div ref={slot.setNode} className="flex items-center gap-2" />
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/page-header.tsx
git commit -m "Let the page heading row host the table's controls"
```

---

### Task 5: DataTable gives up its line

**Files:**
- Modify: `src/components/ui/data-table/data-table.tsx:347-395`

**Interfaces:**
- Consumes: `useTableToolbarSlot` from Task 3.
- Produces: no prop changes. `search`, `actions` and `menuActions` keep their current signatures; `search` is accepted and ignored.

- [ ] **Step 1: Import the slot and React's portal**

In `src/components/ui/data-table/data-table.tsx`:

```ts
import { createPortal } from "react-dom";
import { useTableToolbarSlot } from "@/components/layout/table-toolbar-slot";
```

- [ ] **Step 2: Claim the slot for as long as the table is mounted**

Beside the component's other hooks:

```ts
  const toolbarSlot = useTableToolbarSlot();

  // Claim on mount so PageHeader renders even on a page whose header has no
  // content of its own; release on unmount so it goes back to returning null.
  useEffect(() => {
    toolbarSlot.claim();
    return () => toolbarSlot.release();
  }, [toolbarSlot.claim, toolbarSlot.release]);
```

- [ ] **Step 3: Lift the controls into a variable**

Directly above the `return (`, build the controls once so the same markup can
go either to the header or inline:

```tsx
  const toolbarControls = (
    <>
      <TableViewsBar view={tableView} />
      <span className="font-semibold text-foreground text-xs">
        Total: {totalRecords} records
      </span>
      {actions}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More table actions"
          className="flex h-11 w-11 md:h-7 md:w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
          title="Table actions menu"
        >
          <Menu className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 text-xs">
          {menuActions}
          {menuActions && canExport && <DropdownMenuSeparator />}
          {canExport && (
            <DropdownMenuItem
              onClick={handleExport}
              disabled={isExporting}
              className="cursor-pointer gap-2"
            >
              <Download className="size-3.5" />
              {isExporting ? "Exporting…" : "Export CSV"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
```

- [ ] **Step 4: Delete the toolbar line, portal the controls**

Replace the entire `{/* Top Table Toolbar ... */}` block — the `<div>` that
opens with `className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-xl ..."` and everything up to its closing
`</div>` — with:

```tsx
      {/* The toolbar line is gone. Its controls now sit in the page heading
          row, reached through a portal, so the grid starts right at the top of
          the page. The inline fallback is not decorative: a table rendered
          outside the dashboard shell has no slot, and controls with nowhere to
          go would vanish silently. */}
      {toolbarSlot.node
        ? createPortal(toolbarControls, toolbarSlot.node)
        : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-2.5 py-1.5 text-xs">
            {toolbarControls}
          </div>
        )}
```

- [ ] **Step 5: Give the grid back its top corners**

The line carried `rounded-t-xl` and the grid below it was deliberately square
on top. With the line gone the grid is the top edge. Find the wrapper directly
below and change:

```tsx
          "flex flex-col border border-border bg-card",
```

to:

```tsx
          "flex flex-col rounded-t-xl border border-border bg-card",
```

- [ ] **Step 6: Drop the search box and its now-dead imports**

The `search` prop stays in the interface so no page file changes, but nothing
renders it any more. Mark it in its own doc comment:

```ts
  /**
   * Accepted and ignored since the toolbar line was removed — every column
   * carries its own filter now. Kept on the interface so the 20-odd screens
   * that pass it keep compiling; delete the prop and its call sites in a
   * separate pass.
   */
```

Run `npm run lint` and remove whatever it now reports as unused — `Search`
and `Input` are the likely ones, but only if nothing else in the file uses
them. Check before deleting.

- [ ] **Step 7: Typecheck and test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS. Nothing in the suite asserts on the toolbar line; if something does, it is a real regression — read it before changing it.

- [ ] **Step 8: Check it in the browser**

Start the dev server through the preview tool and visit `/orders`, `/contacts`, `/products` and `/leads`.

Confirm on each:
1. The old line is gone and the grid starts directly below the heading row.
2. "All records", "Total: N records" and the hamburger sit in the heading row.
3. The hamburger still opens, and Export CSV and Manage Column still work.
4. The column filter row below the headings is untouched.
5. No duplicated controls, and nothing overflows the heading row at phone width.

- [ ] **Step 9: Commit and push**

```bash
git add src/components/ui/data-table/data-table.tsx
git commit -m "Drop the table toolbar line, move its controls to the heading row"
git push origin main
```

---

### Task 6: Sweep the nine screens that pushed buttons into the line

Categories, Units, Customers, Expenses, Leads, Leaves, Products, Stock and Roles pass `actions` to their `DataTable`. Those buttons now land in the heading row beside each page's own `PageHeader` actions, so a near-duplicate pair may appear.

**Files:**
- Modify (only where a duplicate is found): `src/app/(dashboard)/catalog/categories/page.tsx`, `src/app/(dashboard)/catalog/units/page.tsx`, `src/app/(dashboard)/contacts/page.tsx`, `src/app/(dashboard)/expenses/page.tsx`, `src/app/(dashboard)/leads/page.tsx`, `src/app/(dashboard)/location-tracking/leaves/page.tsx`, `src/app/(dashboard)/products/page.tsx`, `src/app/(dashboard)/stock/page.tsx`, `src/app/(dashboard)/team/roles/page.tsx`

**Interfaces:**
- Consumes: the finished Task 5.
- Produces: nothing.

- [ ] **Step 1: Open each of the nine in the browser**

With the dev server running, visit each page and look at the heading row.

- [ ] **Step 2: For each, decide and record**

For every page, one of:
- **No duplicate** — leave the file alone.
- **Duplicate pair** (for example "Add Product" from both `PageHeader` and `DataTable`) — delete the `DataTable` one, keeping the `PageHeader` one, because that is where every other page puts its primary button.
- **Row overflows at phone width** — note it; do not fix it here.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit and push**

```bash
git add -A "src/app/(dashboard)"
git commit -m "Clear the doubled buttons the heading row exposed"
git push origin main
```

- [ ] **Step 5: Report**

State the commit hash, and list which of the nine had a duplicate, which did not, and any phone-width overflow left for later.

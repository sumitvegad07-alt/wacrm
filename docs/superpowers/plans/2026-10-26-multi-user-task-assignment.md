# Multi-User Task Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can be assigned to several people, and each of them marks their own completion. The task is finished only when everyone has finished it.

**Architecture:** A new `task_assignees` table holds one row per person per task, each with its own status. `tasks.assigned_user_id` **survives**, maintained by trigger as the first assignee, so the report engine, the notification pipeline, the import engine and the APK already in the field keep working unchanged. A rollup trigger sets `tasks.status` to Completed only when every assignee row is Completed.

**Tech Stack:** Supabase/Postgres (migration, triggers, RLS), Next.js 15, React 19, TypeScript, React Native/Expo for mobile, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-activity-defaults-multi-assign-print-toolbar-design.md`

## Global Constraints

- Push directly to `main`. No branches, no PRs.
- Every change applies to all tenants.
- **The migration cannot be applied from here.** The Supabase MCP connection has been permission-denied on Mumbai since 2026-10-16. Write the migration file, hand it to the founder to run, and do not report the feature as working until he confirms it ran.
- **Never trigger an EAS build or `eas update`.** Mobile code is pushed; the founder batches builds.
- `tasks.assigned_user_id` holds a **`profiles.id`**, not an auth user id. Mixing the two is the standing cause of blank screens in this codebase.
- RLS policies wrap `auth.uid()` in a scalar subquery — `(SELECT auth.uid())` — so the planner runs it once rather than per row.
- Tests are Vitest, run with `npm test`, colocated as `src/**/*.test.ts(x)`. Environment is `node`, not jsdom.
- `npm run typecheck` must pass before any commit.
- Dates are account-local. Convert `AT TIME ZONE` the account timezone, never `toISOString()`.

## Order matters

Task 1 is written but **not applied** until the founder runs it. Tasks 2–6 are written against the new schema and must not be deployed before the migration has run, or the app will query a table that does not exist. Stage the work: write everything, get the migration run, then push the app code.

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261026120000_task_assignees.sql`

**Interfaces:**
- Consumes: existing `tasks`, `profiles`.
- Produces: table `task_assignees (id, task_id, profile_id, status, completed_at, created_at)`; trigger function `task_assignees_rollup()`; the backfill.

- [ ] **Step 1: Read the existing schema first**

Read `supabase/migrations/027_tasks_module.sql` for the `tasks` table and its
`status` CHECK, and `supabase/migrations/20260918120000_notifications_foundation.sql`
for the task notification triggers. The new trigger must not fight them.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261026120000_task_assignees.sql`:

```sql
-- ============================================================
-- MULTI-USER TASK ASSIGNMENT
--
-- A task can be assigned to several people, and each marks their own
-- completion. The task is Completed only when everyone is.
--
-- tasks.assigned_user_id is NOT dropped. It keeps pointing at the first
-- assignee, maintained by the trigger below, because the report engine, the
-- notification pipeline, the import engine and every APK already installed on
-- a rep's phone read that column. There is no moment when all clients are new.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_assignees (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task_id ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_profile_id ON task_assignees(profile_id);

-- ------------------------------------------------------------
-- Rollup: assignee rows are the truth, tasks is the summary.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_assignees_rollup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task_id   UUID := COALESCE(NEW.task_id, OLD.task_id);
  v_total     INT;
  v_done      INT;
  v_first     UUID;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'Completed')
    INTO v_total, v_done
    FROM task_assignees WHERE task_id = v_task_id;

  SELECT profile_id INTO v_first
    FROM task_assignees WHERE task_id = v_task_id
    ORDER BY created_at, id LIMIT 1;

  -- With no assignees left the task keeps whatever status it was given by
  -- hand: there is nobody to roll up from, and silently completing it would
  -- be a lie.
  IF v_total = 0 THEN
    UPDATE tasks SET assigned_user_id = NULL, updated_at = NOW()
     WHERE id = v_task_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE tasks
     SET assigned_user_id = v_first,
         status = CASE
                    WHEN v_done = v_total THEN 'Completed'
                    -- Dropping back out of Completed matters: adding a fourth
                    -- person to a finished task makes it unfinished again.
                    WHEN status = 'Completed' THEN 'Pending'
                    ELSE status
                  END,
         updated_at = NOW()
   WHERE id = v_task_id;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_task_assignees_rollup ON task_assignees;
CREATE TRIGGER trg_task_assignees_rollup
  AFTER INSERT OR UPDATE OF status OR DELETE ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION task_assignees_rollup();

-- ------------------------------------------------------------
-- Backfill: one row per already-assigned task, so nothing changes for
-- existing data. Runs before RLS is enabled so it is not filtered.
-- ------------------------------------------------------------
INSERT INTO task_assignees (task_id, profile_id, status, completed_at)
SELECT t.id,
       t.assigned_user_id,
       CASE WHEN t.status = 'Completed' THEN 'Completed' ELSE 'Pending' END,
       CASE WHEN t.status = 'Completed' THEN t.updated_at END
  FROM tasks t
 WHERE t.assigned_user_id IS NOT NULL
ON CONFLICT (task_id, profile_id) DO NOTHING;

-- ------------------------------------------------------------
-- RLS: reachable only through the parent task, so it cannot drift from the
-- task's own policy. auth.uid() wrapped in a subquery so it runs once per
-- query rather than once per row.
-- ------------------------------------------------------------
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_assignees follow their task" ON task_assignees;
CREATE POLICY "task_assignees follow their task" ON task_assignees
  FOR ALL
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id));

-- ------------------------------------------------------------
-- Notify every assignee, not just the first.
--
-- The existing triggers on tasks.assigned_user_id already cover the first
-- assignee. This one skips that person so nobody is notified twice.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notif_task_assignee_added() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_primary UUID;
BEGIN
  SELECT assigned_user_id INTO v_primary FROM tasks WHERE id = NEW.task_id;
  IF NEW.profile_id IS DISTINCT FROM v_primary THEN
    PERFORM notif_emit('task_assigned', NEW.task_id, NEW.profile_id, NOW());
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notif_task_assignee_added ON task_assignees;
CREATE TRIGGER trg_notif_task_assignee_added
  AFTER INSERT ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION notif_task_assignee_added();
```

- [ ] **Step 3: Match the real notification helper**

`notif_emit` above is a placeholder name. Open
`supabase/migrations/20260918120000_notifications_foundation.sql`, find how the
existing task-assigned trigger actually emits its notification, and replace the
`PERFORM` line with that exact call and argument order. **Do not guess the
signature** — a wrong call fails at runtime, not at migration time.

- [ ] **Step 4: Verify the RLS policy against the real tasks policy**

The policy above leans entirely on `tasks` being filtered by its own RLS. Read
the current policy on `tasks` and confirm that holds. If `tasks` is scoped by
`account_id`, the `EXISTS` is enough. If it is not, this policy leaks across
tenants — **stop and report** rather than inventing a scoping rule.

- [ ] **Step 5: Hand it to the founder**

The MCP connection cannot apply DDL on Mumbai. Give him the file path and the
explicit statement that this must be run before any of the app code in Tasks
2–6 is deployed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261026120000_task_assignees.sql
git commit -m "Migration: task_assignees, with rollup and backfill"
git push origin main
```

- [ ] **Step 7: Wait for confirmation**

Do not start Task 4 until the founder confirms the migration ran. Tasks 2 and 3
are pure logic and can proceed meanwhile.

---

### Task 2: Assignee rollup logic, in TypeScript

The same rules the trigger enforces, needed by the UI to show progress without a round trip. Pure, so it is tested properly.

**Files:**
- Create: `src/lib/tasks/assignees.ts`
- Create: `src/lib/tasks/assignees.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface TaskAssignee { id: string; task_id: string; profile_id: string; status: "Pending" | "Completed"; completed_at: string | null; created_at: string }`
  - `export function rollupStatus(assignees: TaskAssignee[], current: string): string`
  - `export function myStatus(assignees: TaskAssignee[], profileId: string | null | undefined): "Pending" | "Completed" | null`
  - `export function progressLabel(assignees: TaskAssignee[]): string | null`
  - `export function assigneeLabel(names: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tasks/assignees.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  assigneeLabel,
  myStatus,
  progressLabel,
  rollupStatus,
  type TaskAssignee,
} from "./assignees";

let seq = 0;
const a = (profile_id: string, status: "Pending" | "Completed" = "Pending"): TaskAssignee => ({
  id: `a${seq++}`,
  task_id: "t1",
  profile_id,
  status,
  completed_at: status === "Completed" ? "2026-10-26T00:00:00.000Z" : null,
  created_at: `2026-10-2${seq}T00:00:00.000Z`,
});

describe("rollupStatus", () => {
  test("everyone done completes the task", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2", "Completed")], "Pending")).toBe("Completed");
  });

  // The founder's explicit choice: one person finishing does not finish it.
  test("one of three done leaves it open", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2"), a("p3")], "Pending")).toBe("Pending");
  });

  test("adding a person to a finished task reopens it", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2")], "Completed")).toBe("Pending");
  });

  test("an in-between status the user set by hand is left alone", () => {
    expect(rollupStatus([a("p1"), a("p2")], "In Progress")).toBe("In Progress");
  });

  // Nobody to roll up from, so nothing is asserted about the task.
  test("no assignees leaves the status exactly as it was", () => {
    expect(rollupStatus([], "In Progress")).toBe("In Progress");
    expect(rollupStatus([], "Completed")).toBe("Completed");
  });
});

describe("myStatus", () => {
  test("gives your own row's status", () => {
    const rows = [a("p1", "Completed"), a("p2")];
    expect(myStatus(rows, "p1")).toBe("Completed");
    expect(myStatus(rows, "p2")).toBe("Pending");
  });

  test("null when you are not on the task", () => {
    expect(myStatus([a("p1")], "p9")).toBeNull();
    expect(myStatus([a("p1")], null)).toBeNull();
  });
});

describe("progressLabel", () => {
  test("counts the done ones when there are several people", () => {
    expect(progressLabel([a("p1", "Completed"), a("p2"), a("p3")])).toBe("1 of 3 done");
  });

  // A single-assignee task is the normal case and gains nothing from "0 of 1".
  test("stays quiet for one person or none", () => {
    expect(progressLabel([a("p1")])).toBeNull();
    expect(progressLabel([])).toBeNull();
  });
});

describe("assigneeLabel", () => {
  test("one name on its own", () => {
    expect(assigneeLabel(["Priya"])).toBe("Priya");
  });

  test("the first name carries the rest as a count", () => {
    expect(assigneeLabel(["Priya", "Rahul", "Sana"])).toBe("Priya +2");
  });

  test("nobody assigned says so", () => {
    expect(assigneeLabel([])).toBe("Unassigned");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/tasks/assignees.test.ts`
Expected: FAIL — cannot resolve `./assignees`.

- [ ] **Step 3: Write the module**

Create `src/lib/tasks/assignees.ts`:

```ts
export interface TaskAssignee {
  id: string;
  task_id: string;
  profile_id: string;
  status: "Pending" | "Completed";
  completed_at: string | null;
  created_at: string;
}

/**
 * What the task's own status should be, given its assignee rows.
 *
 * Mirrors the `task_assignees_rollup` trigger exactly. The database is the
 * authority; this exists so the UI can show the answer immediately instead of
 * waiting for a round trip. If the two ever disagree, the trigger is right.
 */
export function rollupStatus(assignees: TaskAssignee[], current: string): string {
  if (assignees.length === 0) return current;
  const done = assignees.filter((a) => a.status === "Completed").length;
  if (done === assignees.length) return "Completed";
  return current === "Completed" ? "Pending" : current;
}

/** Your own row's status, or null when the task is not yours. */
export function myStatus(
  assignees: TaskAssignee[],
  profileId: string | null | undefined,
): "Pending" | "Completed" | null {
  if (!profileId) return null;
  return assignees.find((a) => a.profile_id === profileId)?.status ?? null;
}

/**
 * "1 of 3 done", so it is obvious the task lives on after you tick your box.
 * Silent for one assignee: that is the ordinary case and "0 of 1" is noise.
 */
export function progressLabel(assignees: TaskAssignee[]): string | null {
  if (assignees.length < 2) return null;
  const done = assignees.filter((a) => a.status === "Completed").length;
  return `${done} of ${assignees.length} done`;
}

/** "Priya +2" — a list column has room for one name and a count. */
export function assigneeLabel(names: string[]): string {
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/lib/tasks/assignees.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/assignees.ts src/lib/tasks/assignees.test.ts
git commit -m "Rollup rules for multi-assignee tasks, mirroring the trigger"
```

---

### Task 3: The task form takes several people

**Files:**
- Modify: `src/components/tasks/task-form.tsx:108`, `:175`, `:210`, `:347`, `:553-560`
- Modify: `src/types/index.ts:719`

**Interfaces:**
- Consumes: `TaskAssignee` from Task 2.
- Produces: on save, the form writes `tasks.assigned_user_id` (first picked) and replaces the task's `task_assignees` rows.

- [ ] **Step 1: Widen the Task type**

In `src/types/index.ts`, beside `assigned_user_id`:

```ts
  assigned_user_id?: string | null;
  /** Everyone on the task. assigned_user_id is the first of these. */
  assignees?: TaskAssignee[];
```

Import `TaskAssignee` from `@/lib/tasks/assignees`.

- [ ] **Step 2: Hold a list, not one id**

In `src/components/tasks/task-form.tsx`, change:

```ts
  const [assignedUserId, setAssignedUserId] = useState("");
```

to:

```ts
  // First in the list is the one written to tasks.assigned_user_id, which is
  // what the report engine and the already-installed APKs read.
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
```

Update the two places that seed it. On edit (around line 175):

```ts
        setAssignedUserIds(
          task.assignees?.length
            ? task.assignees.map((a) => a.profile_id)
            : task.assigned_user_id
              ? [task.assigned_user_id]
              : [],
        );
```

On create (around line 210):

```ts
        setAssignedUserIds(profile?.id ? [profile.id] : []);
```

- [ ] **Step 3: Load the assignee rows when editing**

Wherever the form fetches the task for editing, select the rows too:

```ts
        .select("*, assignees:task_assignees(id, task_id, profile_id, status, completed_at, created_at)")
```

- [ ] **Step 4: Make the control a multi-select**

Replace the `SearchableSelect` under the "Assigned To" label with the
codebase's existing multi-select. **Look for one before writing a new
component** — check `src/components/ui/` for a multi-select, and check how
`price-lists` or `territories` let a user pick several records. Use what is
there. Only if nothing exists, render `SearchableSelect` for adding plus a row
of removable chips for the chosen people.

Assignment stays optional: zero people is valid, as today.

- [ ] **Step 5: Save both sides**

Around line 347, change the task payload:

```ts
      assigned_user_id: assignedUserIds[0] || null,
```

Then, after the task row is saved and its id is known, replace its assignee
rows. Delete-then-insert is deliberate: the set is small, and reconciling
additions against removals in the client is more code and more ways to be
wrong.

```ts
      // The rollup trigger fires on these writes and sets tasks.status and
      // tasks.assigned_user_id. Do not also set status here — two writers
      // disagreeing is how a task ends up Completed with work outstanding.
      await supabase.from("task_assignees").delete().eq("task_id", taskId);
      if (assignedUserIds.length > 0) {
        await supabase.from("task_assignees").insert(
          assignedUserIds.map((profile_id) => ({ task_id: taskId, profile_id })),
        );
      }
```

A re-saved task loses the completion state of assignees who were already done.
That is a known cost of delete-then-insert. If that proves wrong in use,
reconcile instead — but do not build that until it is asked for.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/tasks/task-form.tsx src/types/index.ts
git commit -m "Assign a task to several people"
```

---

### Task 4: My Activity shows your own status

**Requires the migration from Task 1 to have been run.**

**Files:**
- Modify: `src/app/(dashboard)/follow-ups/page.tsx`
- Modify: `src/components/tasks/task-list-embedded.tsx`
- Modify: `src/app/(dashboard)/tasks/page.tsx`, `src/app/(dashboard)/tasks/[id]/page.tsx`

**Interfaces:**
- Consumes: `myStatus`, `progressLabel`, `assigneeLabel`, `TaskAssignee` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Select the assignee rows**

In `fetchTasks` in the follow-ups page, extend the select:

```ts
      .select("*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), assignees:task_assignees(id, task_id, profile_id, status, completed_at, created_at, profile:profiles(full_name, email)), contact:contacts(id, name), deal:deals(id, title), lead:leads(id, name)")
```

- [ ] **Step 2: Filter on any assignee, not just the first**

Change:

```ts
    if (assignTo && assignTo !== "all") query = query.eq("assigned_user_id", assignTo);
```

to:

```ts
    // Any assignee, not just the first — otherwise someone added second to a
    // task would never see it on the screen named My Activity.
    if (assignTo && assignTo !== "all") {
      const { data: mine } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("profile_id", assignTo);
      query = query.in("id", (mine ?? []).map((r) => r.task_id));
    }
```

An empty list must produce an empty screen, not an unfiltered one. Confirm
`.in("id", [])` behaves that way against this Supabase client version; if it
does not, short-circuit and set `tasks` to `[]` without querying.

- [ ] **Step 3: Show your own status and the progress**

In the row rendering, use `myStatus(task.assignees ?? [], profile?.id)` for the
status shown when you are an assignee, falling back to `task.status` when you
are not. Render `progressLabel(task.assignees ?? [])` beside it when it is not
null, and `assigneeLabel(...)` for the assignee column.

- [ ] **Step 4: Complete your own row only**

Find the handler that marks a task done. It currently writes
`tasks.status = 'Completed'`. Change it to write **your own assignee row**:

```ts
    // Your row only. The trigger decides whether that finishes the task —
    // writing tasks.status here as well would complete it for everyone.
    await supabase
      .from("task_assignees")
      .update({ status: "Completed", completed_at: new Date().toISOString() })
      .eq("task_id", task.id)
      .eq("profile_id", profile.id);
```

A task where you are **not** an assignee keeps today's behaviour: write
`tasks.status` directly.

- [ ] **Step 5: Do the same on the other three task surfaces**

Apply steps 1, 3 and 4 to `task-list-embedded.tsx`, `/tasks/page.tsx` and
`/tasks/[id]/page.tsx`. The detail page shows every assignee with their
individual status, not just the count.

- [ ] **Step 6: Typecheck and check in the browser**

Run: `npm run typecheck`
Expected: no errors.

Then, as two different users:
1. Create a task assigned to three people.
2. As the first, confirm it shows "0 of 3 done" and complete it.
3. Confirm it now shows "1 of 3 done" and the task is **still open**.
4. As the second, confirm it is still open for them.
5. Complete it as the second and third; confirm the task becomes Completed.
6. Confirm an existing single-assignee task behaves exactly as before.

- [ ] **Step 7: Commit and push**

```bash
git add "src/app/(dashboard)" src/components/tasks
git commit -m "Each assignee marks their own task complete"
git push origin main
```

---

### Task 5: Report engine and import engine

**Requires the migration from Task 1 to have been run.**

**Files:**
- Create: `supabase/migrations/20261026130000_task_report_multi_assignee.sql`
- Modify: whichever of `supabase/migrations/20260823100000_universal_import_task_territory.sql`'s functions `import_commit` currently uses for tasks — as a **new** migration, never by editing an applied one

**Interfaces:**
- Consumes: Task 1's table.
- Produces: the Task report's `assignee` dimension joins through `task_assignees`.

- [ ] **Step 1: Read the existing report registration**

Read `supabase/migrations/20260818160000_task_report_module.sql`, especially
the `('task', 'assignee', 'LEFT JOIN profiles u ON base.assigned_user_id = u.id')`
row and the "my tasks" filter row. Note their exact table and column names.

- [ ] **Step 2: Write the report migration**

Create `supabase/migrations/20261026130000_task_report_multi_assignee.sql`
that updates those two rows:

```sql
-- The assignee dimension reads every assignee now, not only the first.
--
-- This CHANGES REPORTED NUMBERS: grouped by assignee, a task with three
-- people becomes three rows. That is the right answer to "how many tasks does
-- Priya have", but it will not match an export taken before this ran.
-- Flagged to the founder and accepted.
-- The `assignee` join. Note `ta` is introduced here and `u` still resolves to
-- profiles, so every dimension and measure already written against `u` keeps
-- working untouched.
UPDATE report_registry_joins
   SET sql_join = 'LEFT JOIN task_assignees ta ON ta.task_id = base.id LEFT JOIN profiles u ON ta.profile_id = u.id'
 WHERE module_name = 'task' AND join_key = 'assignee';

-- The "Assigned to" filter. Compared as TEXT and never cast to uuid, exactly
-- as the original did — casting raises 22P02 on the object payload shape
-- instead of simply not matching.
UPDATE report_registry_filters
   SET sql_where = 'EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = base.id AND ta2.profile_id IN (SELECT p.id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'')))'
 WHERE module_name = 'task' AND key = 'user';
```

The filter uses its own alias `ta2`: the filter's SQL and the join's SQL can
land in the same statement, and reusing `ta` would collide.

- [ ] **Step 3: Keep the import engine consistent**

`import_commit` writes `assigned_user_id`. In the same new migration, make it
also write the matching `task_assignees` row so an imported task is not
half-assigned:

```sql
-- after the existing INSERT INTO tasks(...) / UPDATE tasks ... assigned_user_id
INSERT INTO task_assignees (task_id, profile_id)
SELECT v_task_id, v_pid
 WHERE v_pid IS NOT NULL
ON CONFLICT (task_id, profile_id) DO NOTHING;
```

Match the real variable names in that function. Multi-assignee import from a
spreadsheet is **out of scope** — one assignee per imported row.

- [ ] **Step 4: Hand it to the founder**

Same as Task 1: it cannot be applied from here.

- [ ] **Step 5: Verify once it has run**

Run the Task report grouped by assignee. Confirm a three-person task
contributes three rows, and that a single-assignee task still contributes one.

- [ ] **Step 6: Commit and push**

```bash
git add supabase/migrations/20261026130000_task_report_multi_assignee.sql
git commit -m "Task report counts every assignee"
git push origin main
```

---

### Task 6: Mobile

**Requires the migration from Task 1 to have been run. Do NOT trigger an EAS build.**

**Files:**
- Modify: the ~10 call sites in `C:\Wacrm\wacrm-mobile` that read `assigned_user_id`

**Interfaces:**
- Consumes: Task 1's table.
- Produces: mobile shows all assignees and completes only the signed-in user's row.

- [ ] **Step 1: Find every call site**

```bash
cd C:/Wacrm/wacrm-mobile && grep -rn "assigned_user_id" src app --include=*.ts --include=*.tsx
```

List them and decide per site whether it reads the assignee for display, for
filtering, or for completion.

- [ ] **Step 2: Port the rollup helpers**

Copy `src/lib/tasks/assignees.ts` from the web repo into the mobile repo's
matching lib folder, unchanged. It has no web dependencies. The two copies
must not drift; note in the file that web is the source.

- [ ] **Step 3: Read the assignee rows**

Extend the mobile task selects the same way as the web ones:

```ts
  .select("*, assignees:task_assignees(id, task_id, profile_id, status, completed_at, created_at)")
```

- [ ] **Step 4: Show and complete per person**

Display `assigneeLabel` and `progressLabel`. The complete action writes the
signed-in user's `task_assignees` row, exactly as the web does, not
`tasks.status`.

- [ ] **Step 5: Mind the offline queue**

Mobile queues writes offline. A `task_assignees` write for a task created in
the same offline session is a parent/child write: a foreign-key `23503` there
is **transient**, not permanent, and must be retried rather than discarded.
Confirm the queue's existing parent/child handling covers this new table
before relying on it.

- [ ] **Step 6: Typecheck**

Run the mobile repo's typecheck script.
Expected: no errors.

- [ ] **Step 7: Commit and push — build nothing**

```bash
cd C:/Wacrm/wacrm-mobile
git add -A
git commit -m "Mobile: several people on a task, each completing their own"
git push origin main
```

**Do not run `eas build` or `eas update`.** Tell the founder the mobile code is
pushed and waiting for his next batched build.

- [ ] **Step 8: Report**

Give the commit hashes for both repos, state that the migration must be run by
him, and state plainly that no APK was built and mobile is therefore
unverified on a device.

import { myStatus, type TaskAssignee } from "./assignees";

/**
 * The one place that knows how a task gets marked done.
 *
 * Four screens offer the tick — My Activity, the Tasks table, the task detail
 * page and the list embedded on a customer or deal — and they must all agree.
 * The rule has two halves:
 *
 *   - You are one of the assignees: your own `task_assignees` row changes, and
 *     the rollup trigger decides whether that finishes the task. Writing
 *     `tasks.status` as well would finish it for everyone else too.
 *   - The task is not assigned to you: there is no row to tick, so the task's
 *     own status changes, exactly as it always did.
 *
 * Deliberately returns the error instead of toasting: each caller words its
 * own message, and the embedded list has no toast at all.
 */

/** Just enough of the Supabase client to do these two writes. */
interface MinimalClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): {
        eq(column: string, value: string): PromiseLike<{ error: unknown }>;
      } & PromiseLike<{ error: unknown }>;
    };
  };
}

export async function setTaskCompletion(
  supabase: MinimalClient,
  args: {
    taskId: string;
    assignees: TaskAssignee[];
    profileId: string | null | undefined;
    /** The status to move to — "Completed" or back to "Pending". */
    newStatus: "Completed" | "Pending";
  },
): Promise<{ error: unknown; perPerson: boolean }> {
  const { taskId, assignees, profileId, newStatus } = args;
  const mine = myStatus(assignees, profileId);
  const timestamp = new Date().toISOString();

  if (mine !== null && profileId) {
    const { error } = await supabase
      .from("task_assignees")
      .update({
        status: newStatus,
        completed_at: newStatus === "Completed" ? timestamp : null,
      })
      .eq("task_id", taskId)
      .eq("profile_id", profileId);
    return { error, perPerson: true };
  }

  const { error } = await supabase
    .from("tasks")
    .update({ status: newStatus, updated_at: timestamp })
    .eq("id", taskId);
  return { error, perPerson: false };
}

/**
 * What the tick should look like: your own state when the task is yours, the
 * task's rolled-up state when you are only watching someone else's work.
 */
export function displayedStatus(
  assignees: TaskAssignee[],
  profileId: string | null | undefined,
  taskStatus: string,
): string {
  return myStatus(assignees, profileId) ?? taskStatus;
}

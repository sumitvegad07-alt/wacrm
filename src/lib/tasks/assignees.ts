export interface TaskAssignee {
  id: string;
  task_id: string;
  profile_id: string;
  status: "Pending" | "Completed";
  completed_at: string | null;
  created_at: string;
  /** Joined on the screens that select it, for showing names rather than ids. */
  profile?: { full_name: string | null; email: string | null } | null;
}

/**
 * What the task's own status should be, given its assignee rows.
 *
 * Mirrors the `task_assignees_rollup` trigger exactly. The database is the
 * authority; this exists so the UI can show the answer immediately instead of
 * waiting for a round trip. If the two ever disagree, the trigger is right.
 *
 * Note what it does NOT do: a status the user set by hand — In Progress,
 * Waiting, Cancelled — is left alone. Only Completed is derived, and only a
 * task that had been Completed is dropped back out of it.
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

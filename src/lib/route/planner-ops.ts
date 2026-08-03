// Pure planner helpers (Phase 2c). Kept out of components so they're unit-testable and the
// UI stays logic-free. Framework-agnostic (reusable by mobile later).

export const plannerCellKey = (assigneeId: string, dayOfWeek: number): string =>
  `${assigneeId}:${dayOfWeek}`;

export interface PlannerSlot {
  assignee_id: string;
  day_of_week: number;
}

/**
 * The optimistic result of moving an assignment from one cell to another: the moved row lands
 * on the target (overwriting any assignment already there — mirrors the atomic move RPC), and
 * the source cell is emptied. Rollback (on RPC failure) is the caller's job (React Query).
 */
export function applyOptimisticMove<T extends PlannerSlot>(
  rows: T[],
  from: { assigneeId: string; dayOfWeek: number },
  to: { assigneeId: string; dayOfWeek: number }
): T[] {
  return rows
    .filter((a) => !(a.assignee_id === to.assigneeId && a.day_of_week === to.dayOfWeek))
    .map((a) =>
      a.assignee_id === from.assigneeId && a.day_of_week === from.dayOfWeek
        ? { ...a, assignee_id: to.assigneeId, day_of_week: to.dayOfWeek }
        : a
    );
}

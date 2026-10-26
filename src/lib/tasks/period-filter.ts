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

// Route status pill — shared across list, detail, planner. Presentation only.

import { cn } from "@/lib/utils";
import type { RouteStatus } from "@/lib/route";

const STATUS_META: Record<RouteStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-border bg-muted text-muted-foreground" },
  pending_approval: {
    label: "Pending approval",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  active: {
    label: "Active",
    className: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  },
  rejected: {
    label: "Rejected",
    className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  archived: { label: "Archived", className: "border-border bg-card text-muted-foreground" },
};

export function RouteStatusPill({ status, className }: { status: RouteStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.className,
        className
      )}
    >
      {meta.label}
    </span>
  );
}

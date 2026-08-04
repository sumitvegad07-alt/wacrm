// Route status pill — shared across list, detail, planner. Presentation only.

import { cn } from "@/lib/utils";
import type { RouteStatus } from "@/lib/route";
import { StatusBadge } from "@/components/shared";

const STATUS_LABELS: Record<RouteStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  active: "Active",
  rejected: "Rejected",
  archived: "Archived",
};

export function RouteStatusPill({ status, className }: { status: RouteStatus; className?: string }) {
  const label = STATUS_LABELS[status] ?? "Draft";
  return (
    <StatusBadge status={status} label={label} className={className} />
  );
}

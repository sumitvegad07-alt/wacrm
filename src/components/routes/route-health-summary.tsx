"use client";

// Route health summary (Overview tab). Shows the score AND actionable warnings — each failing
// check explains what's wrong and what to do about it (founder recommendation).

import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RouteHealth, RouteHealthCode } from "@/lib/route";

const CHECK_INFO: Record<RouteHealthCode, { label: string; action: string }> = {
  no_customers: { label: "No customers", action: "Import customers from the Customers tab." },
  primary_assignee_missing: { label: "No primary assignee", action: "Assign a salesman (Edit route)." },
  not_assigned: { label: "Not on the planner", action: "Assign this route to a weekday in the Planning tab." },
  duplicate_name: { label: "Duplicate route name", action: "Another active route uses this name — rename it." },
  capacity_exceeded: { label: "Over capacity", action: "Remove some customers, or raise the limit in Route Settings." },
  contains_flagged_customer: { label: "Customers need review", action: "Some customers are flagged for territory review." },
  outside_territory: { label: "Customers outside territory", action: "Some customers aren't in the assignee's territory." },
};

function scoreTone(score: number): string {
  if (score >= 100) return "text-green-600 dark:text-green-400";
  if (score >= 70) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function RouteHealthSummary({
  health,
  isLoading,
}: {
  health: RouteHealth | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking route health…
      </div>
    );
  }
  if (!health) return null;

  const warnings = health.checks.filter((c) => !c.ok);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Route health</h3>
        <span className={cn("text-2xl font-bold tabular-nums", scoreTone(health.score))}>{health.score}%</span>
      </div>
      {warnings.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" /> All checks passed — this route is ready.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {warnings.filter((c) => c.code !== "capacity_exceeded").map((c) => {
            const info = CHECK_INFO[c.code];
            return (
              <li key={c.code} className="flex items-start gap-2 rounded-lg bg-amber-500/5 p-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{info?.label ?? c.code}</p>
                  <p className="text-xs text-muted-foreground">{info?.action}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

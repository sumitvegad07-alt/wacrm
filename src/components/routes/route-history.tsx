"use client";

// Route History (History tab) — audit entries grouped by date (founder recommendation).

import { Loader2, History as HistoryIcon } from "lucide-react";
import type { RouteHistoryEntry } from "@/lib/route";

const ACTION_LABEL: Record<string, string> = {
  route_created: "Route created",
  route_edited: "Route edited",
  customer_added: "Customers added",
  customer_removed: "Customer removed",
  customers_reordered: "Customers reordered",
  route_submitted: "Submitted for approval",
  route_approved: "Approved",
  route_activated: "Activated",
  route_rejected: "Rejected",
  route_reopened: "Reopened as draft",
  route_archived: "Archived",
  route_restored: "Restored",
  route_cloned: "Cloned",
  route_assigned: "Assigned in planner",
  schedule_changed: "Planner changed",
  route_started: "Route run started",
  route_completed: "Route run completed",
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function RouteHistory({
  entries,
  isLoading,
}: {
  entries: RouteHistoryEntry[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <HistoryIcon className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm">No history yet.</p>
      </div>
    );
  }

  // Group consecutive entries by day (entries are already newest-first).
  const groups: { day: string; items: RouteHistoryEntry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.day}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.day}</h4>
          <ul className="space-y-3 border-l border-border pl-4">
            {g.items.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-foreground">
                    {ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {e.actor_name ? ` · ${e.actor_name}` : ""}
                  </span>
                </div>
                {e.details?.reason ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Reason: {String(e.details.reason)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { PlannerBoard } from "@/components/routes/planner-board";
import { RouteList } from "@/components/routes/route-list";
import { CalendarRange, Table as TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmployeeRouteTabProps {
  employeeId: string;
  accountId: string;
}

export function EmployeeRouteTab({ employeeId }: EmployeeRouteTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<"calendar" | "table">("calendar");

  return (
    <div className="space-y-6">
      {/* Sub-navigation pills */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab("calendar")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            activeSubTab === "calendar"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <CalendarRange className="h-4 w-4" />
          Calendar View
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("table")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            activeSubTab === "table"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <TableIcon className="h-4 w-4" />
          All Routes Table
        </button>
      </div>

      {activeSubTab === "calendar" ? (
        <div className="animate-in fade-in-50 duration-200">
          <PlannerBoard initialAssigneeId={employeeId} />
        </div>
      ) : (
        <div className="animate-in fade-in-50 duration-200">
          <RouteList hideHeader />
        </div>
      )}
    </div>
  );
}

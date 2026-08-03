"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PlannerBoard } from "@/components/routes/planner-board";
import { MonthlyPlannerBoard } from "@/components/routes/monthly-planner";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Calendar, LayoutGrid } from "lucide-react";

export default function RoutePlannerPage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();
  const [viewMode, setViewMode] = useState<"month" | "week">("month");

  if (loading) return null;
  if (!isModuleEnabled("route")) return null; // shell also redirects /routes* when off

  // Viewing the planner needs view_routes; assign/manage actions are gated inside the board.
  if (!hasPermission(ROUTE_PERMISSIONS.VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">No access to the Planner</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Ask an admin to grant “View routes”.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View switcher header */}
      <div className="flex items-center justify-end">
        <div className="flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
          <Button
            variant={viewMode === "month" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("month")}
            className="h-7 px-2.5 text-xs font-semibold"
          >
            <Calendar className="mr-1.5 h-3.5 w-3.5" /> Month View
          </Button>
          <Button
            variant={viewMode === "week" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("week")}
            className="h-7 px-2.5 text-xs font-semibold"
          >
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" /> Week View
          </Button>
        </div>
      </div>

      {viewMode === "month" ? <MonthlyPlannerBoard /> : <PlannerBoard />}
    </div>
  );
}

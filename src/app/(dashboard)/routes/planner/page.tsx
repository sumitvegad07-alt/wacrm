"use client";

import { useAuth } from "@/hooks/use-auth";
import { PlannerBoard } from "@/components/routes/planner-board";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function RoutePlannerPage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();

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

  return <PlannerBoard />;
}

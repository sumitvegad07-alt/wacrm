"use client";

import { useAuth } from "@/hooks/use-auth";
import { usePermissionGate } from "@/hooks/use-permission-gate";
import { RouteList } from "@/components/routes/route-list";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function RoutesPage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();
  // Resolved above the early returns below, so hook order never shifts.
  const gate = usePermissionGate(hasPermission(ROUTE_PERMISSIONS.VIEW));

  if (loading) return null; // dashboard shell shows the load spinner
  // Module off → the shell already redirects; render nothing as a belt-and-suspenders guard.
  if (!isModuleEnabled("route")) return null;

  // `loading` above is the SESSION. Permissions arrive later, with the profile
  // row, and read as false for everyone until they do — so refusing on them
  // here showed the account owner "No access" on every cold load.
  if (gate === "loading") return null; // shell shows the load spinner
  if (gate === "denied") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">No access to Routes</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          You don&apos;t have permission to view routes. Ask an admin to grant the “View routes” permission.
        </p>
      </div>
    );
  }

  return <RouteList />;
}

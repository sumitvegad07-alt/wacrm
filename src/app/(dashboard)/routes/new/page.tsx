"use client";

import { useAuth } from "@/hooks/use-auth";
import { usePermissionGate } from "@/hooks/use-permission-gate";
import { RouteWizard } from "@/components/routes/route-wizard";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function NewRoutePage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();
  // Resolved above the early returns below, so hook order never shifts.
  const gate = usePermissionGate(hasPermission(ROUTE_PERMISSIONS.ADD));
  if (loading) return null;
  if (!isModuleEnabled("route")) return null;

  // `loading` above is the SESSION; permissions arrive later with the profile.
  if (gate === "loading") return null;
  if (gate === "denied") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">No access</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          You don&apos;t have permission to create routes.
        </p>
      </div>
    );
  }

  return <RouteWizard />;
}

"use client";

import { useAuth } from "@/hooks/use-auth";
import { RouteWizard } from "@/components/routes/route-wizard";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function NewRoutePage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();
  if (loading) return null;
  if (!isModuleEnabled("route")) return null;

  if (!hasPermission(ROUTE_PERMISSIONS.ADD)) {
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

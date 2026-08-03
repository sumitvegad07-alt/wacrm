"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { RouteWorkspace } from "@/components/routes/route-workspace";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function RouteDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const { loading, isModuleEnabled, hasPermission } = useAuth();

  if (loading) return null;
  if (!isModuleEnabled("route")) return null;

  if (!hasPermission(ROUTE_PERMISSIONS.VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">No access to Routes</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Ask an admin to grant the “View routes” permission.
        </p>
      </div>
    );
  }

  if (!id) return null;
  return <RouteWorkspace routeId={id} />;
}

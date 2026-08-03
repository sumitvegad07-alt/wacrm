"use client";

import { useAuth } from "@/hooks/use-auth";
import { ApprovalQueue } from "@/components/routes/approval-queue";
import { ROUTE_PERMISSIONS } from "@/lib/route";
import { ShieldAlert } from "lucide-react";

export default function RouteApprovalsPage() {
  const { loading, isModuleEnabled, hasPermission } = useAuth();
  if (loading) return null;
  if (!isModuleEnabled("route")) return null;

  // View the queue with view_routes; approve/reject actions are gated on approve_routes inside.
  if (!hasPermission(ROUTE_PERMISSIONS.VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">No access to Approvals</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Ask an admin to grant “View routes”.</p>
      </div>
    );
  }

  return <ApprovalQueue />;
}

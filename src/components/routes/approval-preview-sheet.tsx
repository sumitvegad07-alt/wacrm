"use client";

// Approval preview (Phase 2e) — a slide-over that lets an approver see a pending route in full
// (health + customers + history) and Approve/Reject without leaving the queue. Reuses the
// existing reads and the update-status RPC. UI → hooks → SDK only.

import { useRoute } from "@/hooks/route/use-routes";
import { useUpdateRouteStatus } from "@/hooks/route/use-route-mutations";
import { ROUTE_PERMISSIONS, type RouteError } from "@/lib/route";
import { useAuth } from "@/hooks/use-auth";
import { RouteWorkspace } from "./route-workspace";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function ApprovalPreviewSheet({
  routeId,
  accountId,
  open,
  onClose,
}: {
  routeId: string | null;
  accountId: string | null | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission(ROUTE_PERMISSIONS.APPROVE);

  const routeQ = useRoute(open ? routeId : null);
  const setStatus = useUpdateRouteStatus(accountId);

  const route = routeQ.data;

  const decide = async (approve: boolean) => {
    if (!routeId) return;
    let reason: string | undefined;
    if (!approve) {
      reason = window.prompt("Reason for rejection (optional):") ?? undefined;
      if (reason === undefined) return; // cancelled
    }
    try {
      await setStatus.mutateAsync({ routeId, status: approve ? "active" : "rejected", reason });
      toast.success(approve ? "Route approved" : "Route rejected");
      onClose();
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl md:max-w-3xl">
        <SheetHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <SheetTitle>{route?.name ?? "Route Preview"}</SheetTitle>
            <SheetDescription>
              {route ? `Status: ${route.status.replace("_", " ")}${route.description ? ` · ${route.description}` : ""}` : "Loading…"}
            </SheetDescription>
          </div>
          {route && (
            <Button size="sm" variant="ghost" onClick={() => { onClose(); router.push(`/routes/${route.id}`); }}>
              Open full route <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
          {!routeId ? null : routeQ.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading route…</div>
          ) : !route ? (
            <p className="py-8 text-sm text-muted-foreground">Route not found.</p>
          ) : (
            <RouteWorkspace routeId={routeId} readOnly />
          )}
        </div>

        {route && route.status === "pending_approval" && (
          <SheetFooter className="border-t border-border pt-4">
            {canApprove ? (
              <>
                <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => decide(false)} disabled={setStatus.isPending}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => decide(true)} disabled={setStatus.isPending}>
                  {setStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">You don&apos;t have permission to approve routes.</p>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

"use client";

// Route edit Sheet (Phase 2b). Edits header fields (name/description/assignee) in a slide-over
// Sheet rather than inline (founder recommendation). Warns before discarding unsaved changes,
// and uses optimistic concurrency (expectedVersion) so a stale edit is rejected cleanly.

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/shared";
import { useSaveRoute } from "@/hooks/route/use-route-mutations";
import { useAccountEmployees } from "@/hooks/route/use-route-refdata";
import type { Route, RouteError } from "@/lib/route";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { readMappingMode } from "@/lib/customers/mapping";

export function RouteEditSheet({
  route,
  accountId,
  open,
  onOpenChange,
}: {
  route: Route;
  accountId: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirm();
  const employees = useAccountEmployees(accountId);
  const save = useSaveRoute(accountId);

  const [name, setName] = useState(route.name);
  const [description, setDescription] = useState(route.description ?? "");
  const [assigneeId, setAssigneeId] = useState(route.primary_assignee_id ?? "");

  /**
   * Which customer supplies this beat, in beat mapping mode.
   *
   * Saved straight to route_parent_customers rather than through the route RPC:
   * it is not a field of the route, it is who stocks the shops on it, and the
   * route's own version check has nothing to say about it. Every customer
   * permanently on the beat then inherits it by trigger.
   */
  const { accountId: authAccountId, account } = useAuth();
  const supabase = createClient();
  const beatMapping = readMappingMode(account?.settings) === "beat";
  const [supplierId, setSupplierId] = useState("");
  const [savedSupplierId, setSavedSupplierId] = useState("");
  const [supplierChoices, setSupplierChoices] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (!open || !beatMapping || !authAccountId) return;
    let alive = true;
    void (async () => {
      const [{ data: current }, { data: choices }] = await Promise.all([
        supabase
          .from("route_parent_customers")
          .select("parent_id")
          .eq("route_id", route.id)
          .maybeSingle(),
        supabase
          .from("contacts")
          .select("id, company, name, hierarchy_level")
          .eq("account_id", authAccountId)
          .neq("is_active", false)
          .order("hierarchy_level", { ascending: true, nullsFirst: false })
          .order("company"),
      ]);
      if (!alive) return;
      const found = (current as { parent_id?: string } | null)?.parent_id ?? "";
      setSupplierId(found);
      setSavedSupplierId(found);
      setSupplierChoices(
        ((choices ?? []) as { id: string; company: string | null; name: string | null }[]).map((c) => ({
          id: c.id,
          label: c.company || c.name || "Unnamed",
        })),
      );
    })();
    return () => { alive = false; };
  }, [open, beatMapping, authAccountId, route.id, supabase]);

  // Re-seed the form whenever a new route is opened.
  useEffect(() => {
    if (open) {
      setName(route.name);
      setDescription(route.description ?? "");
      setAssigneeId(route.primary_assignee_id ?? "");
    }
  }, [open, route.id, route.name, route.description, route.primary_assignee_id]);

  const dirty =
    name !== route.name ||
    description !== (route.description ?? "") ||
    assigneeId !== (route.primary_assignee_id ?? "") ||
    (beatMapping && supplierId !== savedSupplierId);

  const requestClose = async (next: boolean) => {
    if (!next && dirty && !(await confirm({ title: "Discard unsaved changes?", description: "The edits you made to this route are lost.", confirmLabel: "Discard", variant: "warning" }))) return;
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Route name is required");
    try {
      await save.mutateAsync({
        routeId: route.id,
        name: name.trim(),
        description: description.trim() || null,
        primaryAssigneeId: assigneeId || null,
        expectedVersion: route.version,
      });
      if (beatMapping && supplierId !== savedSupplierId && authAccountId) {
        // Clearing it removes the row, which re-maps the beat's customers to
        // no supplier rather than leaving a stale one behind.
        const { error } = supplierId
          ? await supabase.from("route_parent_customers").upsert(
              { account_id: authAccountId, route_id: route.id, parent_id: supplierId },
              { onConflict: "route_id" },
            )
          : await supabase.from("route_parent_customers").delete().eq("route_id", route.id);
        if (error) {
          toast.error("Route saved, but the supplier could not be set.");
          onOpenChange(false);
          return;
        }
        setSavedSupplierId(supplierId);
      }
      toast.success("Route updated");
      onOpenChange(false);
    } catch (e) {
      const err = e as RouteError;
      toast.error(
        err.kind === "concurrency"
          ? "This route changed elsewhere. Close and reopen to get the latest version."
          : err.message ?? "Failed to save"
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit route</SheetTitle>
          <SheetDescription>Update the route name, description, and primary assignee.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div>
            <Label htmlFor="route-name">Name</Label>
            <Input id="route-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="route-desc">Description</Label>
            <Textarea
              id="route-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="route-assignee">Primary assignee</Label>
            <select
              id="route-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Unassigned</option>
              {(employees.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name ?? "Unnamed"}</option>
              ))}
            </select>
          </div>
          {beatMapping && (
            <div>
              <Label htmlFor="route-supplier">Supplied by</Label>
              <select
                id="route-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">No supplier</option>
                {supplierChoices.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <p className="mt-1 text-caption text-muted-foreground">
                Every customer permanently on this beat takes this supplier. A customer visited
                here on a one-time stop keeps the supplier of the beat they belong to.
              </p>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => requestClose(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending || !dirty}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

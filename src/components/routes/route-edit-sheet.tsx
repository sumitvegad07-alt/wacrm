"use client";

// Route edit Sheet (Phase 2b). Edits header fields (name/description/assignee) in a slide-over
// Sheet rather than inline (founder recommendation). Warns before discarding unsaved changes,
// and uses optimistic concurrency (expectedVersion) so a stale edit is rejected cleanly.

import { useEffect, useState } from "react";
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
  const employees = useAccountEmployees(accountId);
  const save = useSaveRoute(accountId);

  const [name, setName] = useState(route.name);
  const [description, setDescription] = useState(route.description ?? "");
  const [assigneeId, setAssigneeId] = useState(route.primary_assignee_id ?? "");

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
    assigneeId !== (route.primary_assignee_id ?? "");

  const requestClose = (next: boolean) => {
    if (!next && dirty && !window.confirm("Discard unsaved changes to this route?")) return;
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

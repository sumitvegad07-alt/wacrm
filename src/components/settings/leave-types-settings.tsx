"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, CalendarOff, Edit2, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HolidayListsManager } from "./holiday-lists-manager";

/** Palette offered for a leave type's chip, matching the lead/order status colour convention. */
const LEAVE_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#64748b",
];

const STATUS_ITEMS = { Active: "Active", Inactive: "Inactive" };

interface LeaveType {
  id: string;
  account_id: string;
  name: string;
  color: string | null;
  status: "Active" | "Inactive";
  created_at: string;
}

export function LeaveTypesSettings() {
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [tab, setTab] = useState<"types" | "holidays">("types");
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LEAVE_COLORS[0]);
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [saving, setSaving] = useState(false);

  const fetchTypes = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("leave_types")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
    if (error) toast.error("Failed to load leave types");
    else setLeaveTypes((data ?? []) as LeaveType[]);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    void fetchTypes();
  }, [fetchTypes]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setColor(LEAVE_COLORS[0]);
    setStatus("Active");
  };

  const handleEdit = (lt: LeaveType) => {
    setEditingId(lt.id);
    setName(lt.name);
    setColor(lt.color ?? LEAVE_COLORS[0]);
    setStatus(lt.status);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("A leave type name is required");
      return;
    }
    setSaving(true);

    // status defaults to Active in the database too — a new type is usable the moment it is
    // saved, with no second step to remember.
    const payload = {
      account_id: accountId,
      name: name.trim(),
      color,
      status,
      created_by: user?.id,
    };

    const { error } = editingId
      ? await supabase.from("leave_types").update(payload).eq("id", editingId)
      : await supabase.from("leave_types").insert(payload);

    setSaving(false);
    if (error) {
      // The unique index is on lower(name), so a case variant collides too — say so plainly
      // rather than showing a Postgres constraint name.
      toast.error(
        error.code === "23505"
          ? "A leave type with that name already exists"
          : "Could not save the leave type",
      );
      return;
    }

    toast.success(editingId ? "Leave type updated" : "Leave type added");
    setIsDialogOpen(false);
    resetForm();
    void fetchTypes();
  };

  const handleDelete = async (lt: LeaveType) => {
    if (!confirm(`Delete "${lt.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("leave_types").delete().eq("id", lt.id);
    if (error) {
      // ON DELETE RESTRICT: a type that has been used cannot be removed without taking the
      // history with it. Deactivating keeps every past record readable.
      toast.error(
        "This leave type is used by existing leave records and can't be deleted. Set it to Inactive instead.",
      );
      return;
    }
    toast.success("Leave type deleted");
    void fetchTypes();
  };

  const toggleStatus = async (lt: LeaveType) => {
    const next = lt.status === "Active" ? "Inactive" : "Active";
    const { error } = await supabase.from("leave_types").update({ status: next }).eq("id", lt.id);
    if (error) {
      toast.error("Could not update the status");
      return;
    }
    toast.success(
      next === "Inactive"
        ? `${lt.name} hidden from new requests — existing leave is unaffected`
        : `${lt.name} is active again`,
    );
    void fetchTypes();
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in-50 duration-200">
      {/* Inline tab switcher, matching the order detail page's pattern. */}
      <div className="flex items-center gap-1 border-b">
        {(
          [
            { id: "types", label: "Leave Types", icon: CalendarOff },
            { id: "holidays", label: "Holiday Lists", icon: CalendarDays },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "holidays" ? (
        <HolidayListsManager />
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading leave types...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          <div className="xl:col-span-7 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Leave Types</h3>
                <p className="text-sm text-muted-foreground">
                  The kinds of leave your employees can apply for. New types are active immediately.
                </p>
              </div>
              <Dialog
                open={isDialogOpen}
                onOpenChange={(open) => {
                  setIsDialogOpen(open);
                  if (open) resetForm();
                }}
              >
                <DialogTrigger render={<Button />}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Leave Type
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{editingId ? "Edit Leave Type" : "Add Leave Type"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        placeholder="e.g. Casual Leave, Medical Leave"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={status}
                        items={STATUS_ITEMS}
                        onValueChange={(v) => setStatus((v as "Active" | "Inactive") ?? "Active")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Inactive types disappear from new requests. Leave already applied for keeps
                        working.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Colour</Label>
                      <div className="flex flex-wrap gap-2">
                        {LEAVE_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Choose colour ${c}`}
                            onClick={() => setColor(c)}
                            className={`h-7 w-7 rounded-full border-2 transition-transform ${
                              color === c ? "border-foreground scale-110" : "border-transparent"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Save Leave Type"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="rounded-md border bg-card overflow-hidden">
              {leaveTypes.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <CalendarOff className="h-10 w-10 mb-2 opacity-50" />
                  <p>No leave types configured.</p>
                  <p className="text-xs mt-1">
                    Add one — nobody can apply for leave until at least one type exists.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {leaveTypes.map((lt) => (
                    <div
                      key={lt.id}
                      className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: lt.color ?? LEAVE_COLORS[0] }}
                        />
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{lt.name}</h4>
                          <button
                            type="button"
                            onClick={() => toggleStatus(lt)}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider transition-colors ${
                              lt.status === "Active"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                            }`}
                          >
                            {lt.status}
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(lt)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(lt)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="xl:col-span-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">How leave works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarOff className="size-3.5 text-foreground" />
                    <p className="font-medium text-foreground">Approved leave changes attendance</p>
                  </div>
                  <p>
                    A day with approved full-day leave reads <strong>On Leave</strong> instead of a
                    red Absent. A half day reduces the hours expected, so the employee is not
                    flagged for a late start or an early finish they were granted.
                  </p>
                </div>
                <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarDays className="size-3.5 text-foreground" />
                    <p className="font-medium text-foreground">Weekly offs live on holiday lists</p>
                  </div>
                  <p>
                    Each holiday list carries its own weekly offs and holidays, and is assigned to
                    employees. Field staff and office staff can have different weeks.
                  </p>
                </div>
                <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Info className="size-3.5 text-foreground" />
                    <p className="font-medium text-foreground">Deactivate rather than delete</p>
                  </div>
                  <p>
                    A type that has been used cannot be deleted — that would take the leave history
                    with it. Setting it to Inactive hides it from new requests and keeps the record.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

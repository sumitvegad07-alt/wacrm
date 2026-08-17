"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarOff, CalendarPlus, Edit2, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

interface LeaveType {
  id: string;
  account_id: string;
  name: string;
  color: string | null;
  status: "Active" | "Inactive";
  created_at: string;
}

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
}

export function LeaveTypesSettings() {
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  // Leave type dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LEAVE_COLORS[0]);
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [saving, setSaving] = useState(false);

  // Holiday form
  const [holidayYear, setHolidayYear] = useState(() => new Date().getFullYear());
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [types, days] = await Promise.all([
      supabase
        .from("leave_types")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("holidays")
        .select("id, name, holiday_date")
        .eq("account_id", accountId)
        .order("holiday_date", { ascending: true }),
    ]);

    if (types.error) toast.error("Failed to load leave types");
    else setLeaveTypes((types.data ?? []) as LeaveType[]);

    if (days.error) toast.error("Failed to load the holiday calendar");
    else setHolidays((days.data ?? []) as Holiday[]);

    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

    // status defaults to Active in the database too — a new type is usable the moment it is saved,
    // with no second step to remember.
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
    void fetchAll();
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
    void fetchAll();
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
    void fetchAll();
  };

  const handleAddHoliday = async () => {
    if (!holidayName.trim() || !holidayDate) {
      toast.error("A holiday needs both a name and a date");
      return;
    }
    setSavingHoliday(true);
    const { error } = await supabase.from("holidays").insert({
      account_id: accountId,
      name: holidayName.trim(),
      holiday_date: holidayDate,
      created_by: user?.id,
    });
    setSavingHoliday(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "There is already a holiday on that date"
          : "Could not add the holiday",
      );
      return;
    }
    setHolidayName("");
    setHolidayDate("");
    setHolidayYear(new Date(holidayDate).getFullYear());
    toast.success("Holiday added");
    void fetchAll();
  };

  const handleDeleteHoliday = async (h: Holiday) => {
    const { error } = await supabase.from("holidays").delete().eq("id", h.id);
    if (error) {
      toast.error("Could not remove the holiday");
      return;
    }
    toast.success("Holiday removed");
    void fetchAll();
  };

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear(), new Date().getFullYear() + 1]);
    holidays.forEach((h) => set.add(new Date(h.holiday_date).getFullYear()));
    return Array.from(set).sort();
  }, [holidays]);

  const holidaysThisYear = useMemo(
    () => holidays.filter((h) => new Date(h.holiday_date).getFullYear() === holidayYear),
    [holidays, holidayYear],
  );

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading leave settings...</div>;
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in-50 duration-200">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* LEFT: LEAVE TYPES */}
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
                    <Select value={status} onValueChange={(v) => setStatus(v as "Active" | "Inactive")}>
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
                      <div>
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

        {/* RIGHT: HOLIDAY CALENDAR + GUIDANCE */}
        <div className="xl:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-semibold">Holiday Calendar</CardTitle>
                  <CardDescription className="text-xs">
                    Company holidays are never counted as absence, and are skipped when someone
                    takes leave across them.
                  </CardDescription>
                </div>
                <Select
                  value={String(holidayYear)}
                  onValueChange={(v) => setHolidayYear(Number(v))}
                >
                  <SelectTrigger className="w-24 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <Input
                  className="sm:col-span-2"
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                />
                <Input
                  className="sm:col-span-2"
                  placeholder="Holiday name"
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                />
                <Button onClick={handleAddHoliday} disabled={savingHoliday} className="sm:col-span-1">
                  <CalendarPlus className="h-4 w-4" />
                </Button>
              </div>

              {holidaysThisYear.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No holidays added for {holidayYear}.
                </p>
              ) : (
                <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
                  {holidaysThisYear.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">{h.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.holiday_date).toLocaleDateString(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteHoliday(h)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

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
                  A day with approved full-day leave reads <strong>On Leave</strong> instead of a red
                  Absent. A half day reduces the hours expected, so the employee is not flagged for
                  a late start or an early finish they were granted.
                </p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <Info className="size-3.5 text-foreground" />
                  <p className="font-medium text-foreground">Working days live elsewhere</p>
                </div>
                <p>
                  Which days of the week your company works is set in{" "}
                  <strong>Organisation Settings</strong>, alongside the shift timings. Weekly offs
                  are never counted as leave.
                </p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <Trash2 className="size-3.5 text-foreground" />
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
    </div>
  );
}

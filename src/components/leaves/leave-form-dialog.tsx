"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarOff, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LeaveWeightage } from "@/lib/location/attendance-status";
import { LEAVE_DAY_VALUE } from "@/lib/location/attendance-status";
import { classifyDay, eachDay, fromDateKey, toDateKey } from "@/lib/location/working-days";
import {
  createLeaveRequest,
  updateLeaveRequest,
  WEIGHTAGE_OPTIONS,
  type Leave,
  type LeaveType,
} from "@/lib/leave/api";

export interface EmployeeOption {
  id: string;
  full_name: string | null;
}

interface LeaveFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing request, or null to apply for a new one. */
  leave?: Leave | null;
  leaveTypes: LeaveType[];
  employees: EmployeeOption[];
  /** The signed-in user's own profile id — the default and, without rights, the only choice. */
  ownProfileId: string;
  /** True when the user may apply for others and backdate (admin or manage_leaves). */
  canManageOthers: boolean;
  /**
   * Each employee's own working days and holidays, resolved from the holiday list assigned to
   * them. Keyed by profile id. The form reads the calendar of whoever is selected, so applying
   * for a field rep and applying for office staff can legitimately produce different day counts
   * over the same dates.
   */
  calendars: Map<string, { workingDays: number[]; holidays: Map<string, string> }>;
  onSaved: () => void;
}

interface DayRow {
  key: string;
  date: Date;
  kind: "working" | "weekly_off" | "holiday";
  holidayName?: string;
  weightage: LeaveWeightage;
}

export function LeaveFormDialog({
  open,
  onOpenChange,
  leave,
  leaveTypes,
  employees,
  ownProfileId,
  canManageOthers,
  calendars,
  onSaved,
}: LeaveFormDialogProps) {
  const isEdit = Boolean(leave);

  const [employeeId, setEmployeeId] = useState(ownProfileId);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dayRows, setDayRows] = useState<DayRow[]>([]);
  const [reason, setReason] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [saving, setSaving] = useState(false);

  // The calendar of the employee the leave is FOR, not of whoever is filling the form in.
  const calendar = useMemo(
    () =>
      calendars.get(employeeId) ?? {
        workingDays: [1, 2, 3, 4, 5, 6],
        holidays: new Map<string, string>(),
      },
    [calendars, employeeId],
  );
  const holidayMap = calendar.holidays;
  const holidayKeys = useMemo(() => new Set(holidayMap.keys()), [holidayMap]);

  const activeTypes = useMemo(
    () =>
      leaveTypes.filter(
        // An inactive type stays selectable while editing a request that already uses it —
        // otherwise deactivating a type would make its existing requests uneditable.
        (t) => t.status === "Active" || t.id === leave?.leave_type_id,
      ),
    [leaveTypes, leave?.leave_type_id],
  );

  const todayKey = toDateKey(new Date());

  /**
   * Base UI's `Select.Value` renders the raw VALUE unless `Select.Root` is given an `items` map
   * from value to label. Without these the employee picker shows a bare uuid and the weightage
   * picker shows "quarter" instead of "Quarter Day" — which is exactly what shipped first.
   * `expense-types-settings.tsx` sets the precedent for this prop.
   */
  const leaveTypeItems = useMemo(
    () => Object.fromEntries(activeTypes.map((t) => [t.id, t.name])) as Record<string, string>,
    [activeTypes],
  );
  const weightageItems = useMemo(
    () => Object.fromEntries(WEIGHTAGE_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>,
    [],
  );

  // Reset the form whenever it opens, so a previous attempt never bleeds into the next one.
  useEffect(() => {
    if (!open) return;
    if (leave) {
      setEmployeeId(leave.employee_id);
      setLeaveTypeId(leave.leave_type_id);
      setFromDate(leave.from_date);
      setToDate(leave.to_date);
      setReason(leave.reason);
    } else {
      setEmployeeId(ownProfileId);
      setLeaveTypeId(activeTypes[0]?.id ?? "");
      setFromDate(todayKey);
      setToDate(todayKey);
      setReason("");
    }
    setChangeReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leave, ownProfileId]);

  /**
   * Rebuild the per-day list whenever the range changes, preserving any weightage the user has
   * already chosen for a date that is still in range — retyping them after nudging the end date
   * by a day would be maddening.
   */
  const rebuildDays = useCallback(
    (from: string, to: string, existing: DayRow[]) => {
      if (!from || !to) return setDayRows([]);
      const start = fromDateKey(from);
      const end = fromDateKey(to);
      if (end.getTime() < start.getTime()) return setDayRows([]);

      const previous = new Map(existing.map((r) => [r.key, r.weightage]));
      const saved = new Map(
        (leave?.days ?? []).map((d) => [d.leave_date, d.weightage as LeaveWeightage]),
      );

      setDayRows(
        eachDay(start, end).map((date) => {
          const key = toDateKey(date);
          const kind = classifyDay(date, { working_days: calendar.workingDays }, holidayKeys);
          return {
            key,
            date,
            kind,
            holidayName: holidayMap.get(key),
            weightage: previous.get(key) ?? saved.get(key) ?? "full",
          };
        }),
      );
    },
    [calendar.workingDays, holidayKeys, holidayMap, leave?.days],
  );

  useEffect(() => {
    rebuildDays(fromDate, toDate, dayRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, rebuildDays]);

  const bookableDays = dayRows.filter((r) => r.kind === "working");
  const totalDays = bookableDays.reduce((sum, r) => sum + LEAVE_DAY_VALUE[r.weightage], 0);

  const isPastStart = fromDate !== "" && fromDate < todayKey;
  const pastBlocked = isPastStart && !canManageOthers;

  // Anyone editing someone else's request, or one that has already been decided, must say why.
  // That note is what the employee reads later.
  const needsChangeReason =
    isEdit && canManageOthers && (leave?.status !== "Pending" || leave?.employee_id !== ownProfileId);

  const validationError = (() => {
    if (!leaveTypeId) return "Choose a leave type";
    if (!fromDate || !toDate) return "Choose the leave dates";
    if (toDate < fromDate) return "The end date cannot be before the start date";
    if (pastBlocked) return "Leave cannot be applied for a past date";
    if (bookableDays.length === 0) return "This date range contains no working days";
    if (!reason.trim()) return "A reason is required";
    if (isEdit && needsChangeReason && !changeReason.trim()) return "Say why you are changing this";
    return null;
  })();

  const handleSubmit = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);

    const days = bookableDays.map((r) => ({ date: r.key, weightage: r.weightage }));
    const result = isEdit
      ? await updateLeaveRequest({
          leaveId: leave!.id,
          leaveTypeId,
          fromDate,
          toDate,
          days,
          reason: reason.trim(),
          changeReason: changeReason.trim() || null,
        })
      : await createLeaveRequest({
          employeeId,
          leaveTypeId,
          fromDate,
          toDate,
          days,
          reason: reason.trim(),
        });

    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(isEdit ? "Leave updated" : `Leave applied — ${result.data.leave_number}`);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${leave?.leave_number}` : "Apply for Leave"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              {/* SearchableSelect, not a plain Select: an account with a hundred employees needs a
                  search box, and this one opens as a popover BELOW the trigger rather than
                  overlaying it upwards the way the Base UI select does. Same component the task
                  form uses for its customer, order and employee pickers. */}
              <SearchableSelect
                value={employeeId}
                onChange={setEmployeeId}
                placeholder="Select employee..."
                searchPlaceholder="Search employees..."
                options={employees.map((e) => ({
                  value: e.id,
                  label: e.full_name?.trim() || "Unnamed employee",
                }))}
                disabled={!canManageOthers || isEdit}
                className="h-9 w-full"
              />
              {!canManageOthers && (
                <p className="text-xs text-muted-foreground">
                  You can only apply for your own leave.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                Leave Type <span className="text-destructive">*</span>
              </Label>
              <Select value={leaveTypeId} items={leaveTypeItems} onValueChange={(v) => setLeaveTypeId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a leave type" />
                </SelectTrigger>
                <SelectContent>
                  {activeTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeTypes.length === 0 && (
                <p className="text-xs text-destructive">
                  No leave types exist yet. An admin must add one in Settings → Leave Settings.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                From <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={fromDate}
                min={canManageOthers ? undefined : todayKey}
                onChange={(e) => {
                  const next = e.target.value;
                  setFromDate(next);
                  if (toDate && next > toDate) setToDate(next);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>
                To <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          {isPastStart && canManageOthers && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This is a past date. It will be recorded as backdated leave, applied on the
              employee&apos;s behalf.
            </p>
          )}

          {/* Per-day weightage. Weekly offs and holidays are shown but not bookable, so the
              employee can see exactly why a 5-day range only costs 3 days of leave. */}
          {dayRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Days</Label>
                <span className="text-sm text-muted-foreground">
                  Total: <strong className="text-foreground">{totalDays}</strong>{" "}
                  {totalDays === 1 ? "day" : "days"}
                </span>
              </div>
              <div className="rounded-md border divide-y max-h-[420px] overflow-y-auto">
                {dayRows.map((row) => {
                  const off = row.kind !== "working";
                  return (
                    <div
                      key={row.key}
                      className={`flex items-center justify-between gap-4 px-3 py-2 ${
                        off ? "bg-muted/40" : ""
                      }`}
                    >
                      <div className={off ? "text-muted-foreground" : ""}>
                        <p className="text-sm font-medium">
                          {row.date.toLocaleDateString(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                        {off && (
                          <p className="text-xs">
                            {row.kind === "holiday" ? `Holiday — ${row.holidayName}` : "Weekly off"}{" "}
                            · not counted
                          </p>
                        )}
                      </div>
                      {off ? (
                        <CalendarOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Select
                          value={row.weightage}
                          items={weightageItems}
                          onValueChange={(v) =>
                            setDayRows((prev) =>
                              prev.map((r) =>
                                r.key === row.key ? { ...r, weightage: v as LeaveWeightage } : r,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="w-[150px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEIGHTAGE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                rows={3}
                placeholder="Why are you taking this leave?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

          {needsChangeReason && (
            <div className="space-y-2">
              <Label>
                Reason for the change <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Employee asked to move it by a day"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recorded on the leave&apos;s history, with your name and the time.
              </p>
            </div>
          )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <p className="text-xs text-destructive">{validationError ?? ""}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saving || Boolean(validationError)}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Save Changes" : "Apply for Leave"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listEmployeeAssignments,
  listHolidayLists,
  listHolidays,
  workingDaysOf,
  WEEKDAYS,
  type Holiday,
  type HolidayList,
} from "@/lib/leave/api";
import { eachDay, toDateKey } from "@/lib/location/working-days";

interface EmployeeRow {
  id: string;
  full_name: string | null;
  holiday_list_id: string | null;
}

/**
 * Holiday lists — the admin's calendar builder.
 *
 * A list is a named set of weekly offs plus dated holidays, assignable to employees. Field staff
 * and office staff routinely need different ones, which is why a single company-wide calendar was
 * not enough. An employee with no assignment follows the account's Default list.
 */
export function HolidayListsManager() {
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [lists, setLists] = useState<HolidayList[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Weekend chooser holds a draft until "Set Weekend" is pressed, so a half-finished selection
  // never briefly makes every day a working day for everyone on the list.
  const [weekendDraft, setWeekendDraft] = useState<number[]>([0]);

  const [listDialog, setListDialog] = useState<{ mode: "create" | "rename"; name: string } | null>(
    null,
  );
  const [dayDialog, setDayDialog] = useState<{ dateKey: string; name: string; existing: Holiday | null } | null>(
    null,
  );
  const [assignOpen, setAssignOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [l, h, e] = await Promise.all([
        listHolidayLists(accountId),
        listHolidays(accountId),
        listEmployeeAssignments(accountId),
      ]);
      setLists(l);
      setHolidays(h);
      setEmployees(e as EmployeeRow[]);
      setSelectedId((prev) => (prev && l.some((x) => x.id === prev) ? prev : (l[0]?.id ?? null)));
    } catch {
      toast.error("Could not load holiday lists");
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  useEffect(() => {
    setWeekendDraft(selected?.weekly_offs ?? [0]);
  }, [selected]);

  const listHolidayMap = useMemo(() => {
    const map = new Map<string, Holiday>();
    holidays.filter((h) => h.holiday_list_id === selectedId).forEach((h) => map.set(h.holiday_date, h));
    return map;
  }, [holidays, selectedId]);

  const assignedCount = useMemo(() => {
    if (!selected) return 0;
    return employees.filter(
      (e) => e.holiday_list_id === selected.id || (e.holiday_list_id === null && selected.is_default),
    ).length;
  }, [employees, selected]);

  // ── list CRUD ──────────────────────────────────────────────
  const saveList = async () => {
    if (!listDialog || !accountId) return;
    const name = listDialog.name.trim();
    if (!name) {
      toast.error("Give the list a name");
      return;
    }
    setSaving(true);
    const { error } =
      listDialog.mode === "create"
        ? await supabase.from("holiday_lists").insert({
            account_id: accountId,
            name,
            // A brand-new list starts from the company norm rather than a blank week.
            weekly_offs: [0],
            is_default: lists.length === 0,
            created_by: user?.id,
          })
        : await supabase.from("holiday_lists").update({ name }).eq("id", selectedId);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505" ? "A list with that name already exists" : "Could not save the list",
      );
      return;
    }
    toast.success(listDialog.mode === "create" ? "Holiday list created" : "Renamed");
    setListDialog(null);
    void load();
  };

  /** Clone a list with its holidays — the point of the feature is starting from a near-match. */
  const cloneList = async (list: HolidayList) => {
    if (!accountId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("holiday_lists")
      .insert({
        account_id: accountId,
        name: `${list.name} (copy)`,
        weekly_offs: list.weekly_offs,
        is_default: false,
        created_by: user?.id,
      })
      .select("id")
      .single();

    if (error || !data) {
      setSaving(false);
      toast.error(
        error?.code === "23505" ? "A list with that name already exists" : "Could not clone the list",
      );
      return;
    }

    const source = holidays.filter((h) => h.holiday_list_id === list.id);
    if (source.length > 0) {
      await supabase.from("holidays").insert(
        source.map((h) => ({
          account_id: accountId,
          holiday_list_id: data.id,
          name: h.name,
          holiday_date: h.holiday_date,
          created_by: user?.id,
        })),
      );
    }
    setSaving(false);
    toast.success(`Cloned with ${source.length} holiday${source.length === 1 ? "" : "s"}`);
    setSelectedId(data.id);
    void load();
  };

  const deleteList = async (list: HolidayList) => {
    if (list.is_default) {
      // Deleting it would leave unassigned employees with no calendar at all.
      toast.error("The default list can't be deleted. Make another list the default first.");
      return;
    }
    const following = employees.filter((e) => e.holiday_list_id === list.id).length;
    if (
      !confirm(
        following > 0
          ? `Delete "${list.name}"? ${following} employee${following === 1 ? "" : "s"} will fall back to the default list.`
          : `Delete "${list.name}" and its holidays?`,
      )
    )
      return;
    const { error } = await supabase.from("holiday_lists").delete().eq("id", list.id);
    if (error) {
      toast.error("Could not delete the list");
      return;
    }
    toast.success("List deleted");
    void load();
  };

  const makeDefault = async (list: HolidayList) => {
    // Two statements, not one: the partial unique index allows only one default per account, so
    // the old one must be cleared before the new one is set.
    setSaving(true);
    await supabase
      .from("holiday_lists")
      .update({ is_default: false })
      .eq("account_id", accountId)
      .eq("is_default", true);
    const { error } = await supabase.from("holiday_lists").update({ is_default: true }).eq("id", list.id);
    setSaving(false);
    if (error) {
      toast.error("Could not change the default list");
      void load();
      return;
    }
    toast.success(`"${list.name}" is now the default`);
    void load();
  };

  // ── weekend ────────────────────────────────────────────────
  const saveWeekend = async () => {
    if (!selected) return;
    if (weekendDraft.length >= 7) {
      toast.error("At least one day has to be a working day");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("holiday_lists")
      .update({ weekly_offs: [...weekendDraft].sort((a, b) => a - b) })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save the weekend");
      return;
    }
    toast.success("Weekly offs updated");
    void load();
  };

  // ── holidays ───────────────────────────────────────────────
  const saveHoliday = async () => {
    if (!dayDialog || !selected || !accountId) return;
    const name = dayDialog.name.trim();
    if (!name) {
      toast.error("Give the holiday a name");
      return;
    }
    setSaving(true);
    const { error } = dayDialog.existing
      ? await supabase.from("holidays").update({ name }).eq("id", dayDialog.existing.id)
      : await supabase.from("holidays").insert({
          account_id: accountId,
          holiday_list_id: selected.id,
          name,
          holiday_date: dayDialog.dateKey,
          created_by: user?.id,
        });
    setSaving(false);
    if (error) {
      toast.error("Could not save the holiday");
      return;
    }
    toast.success(dayDialog.existing ? "Holiday updated" : "Holiday added");
    setDayDialog(null);
    void load();
  };

  const removeHoliday = async () => {
    if (!dayDialog?.existing) return;
    setSaving(true);
    const { error } = await supabase.from("holidays").delete().eq("id", dayDialog.existing.id);
    setSaving(false);
    if (error) {
      toast.error("Could not remove the holiday");
      return;
    }
    toast.success("Holiday removed");
    setDayDialog(null);
    void load();
  };

  const assignEmployee = async (employeeId: string, listId: string | null) => {
    const { error } = await supabase
      .from("profiles")
      .update({ holiday_list_id: listId })
      .eq("id", employeeId);
    if (error) {
      toast.error("Could not change the assignment");
      return;
    }
    setEmployees((prev) =>
      prev.map((e) => (e.id === employeeId ? { ...e, holiday_list_id: listId } : e)),
    );
  };

  // ── calendar grid ──────────────────────────────────────────
  const weeks = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const lastOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    // Pad to whole weeks so the grid is always rectangular, Sunday-first.
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(lastOfMonth);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    const days = eachDay(gridStart, gridEnd);
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [month]);

  const weekendSet = useMemo(() => new Set(selected?.weekly_offs ?? []), [selected]);
  const todayKey = toDateKey(new Date());

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading holiday lists...</div>;
  }

  return (
    <div className="w-full space-y-4 animate-in fade-in-50 duration-200">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT — the lists */}
        <div className="xl:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">Holiday Lists</h3>
            <Button size="sm" onClick={() => setListDialog({ mode: "create", name: "" })}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>

          <div className="rounded-md border bg-card divide-y overflow-hidden">
            {lists.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No lists yet. Add one to start building a calendar.
              </div>
            ) : (
              lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  className={`w-full text-left px-3 py-3 transition-colors ${
                    l.id === selectedId ? "bg-muted" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.is_default ? "Default · " : ""}
                        {l.weekly_offs.length === 0
                          ? "No weekly off"
                          : l.weekly_offs.map((d) => WEEKDAYS[d].slice(0, 3)).join(", ") + " off"}
                      </p>
                    </div>
                    {l.id === selectedId && (
                      <span className="flex shrink-0 gap-0.5">
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Clone list"
                          className="p-1 rounded hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            void cloneList(l);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && cloneList(l)}
                        >
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Rename list"
                          className="p-1 rounded hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            setListDialog({ mode: "rename", name: l.name });
                          }}
                          onKeyDown={(e) =>
                            e.key === "Enter" && setListDialog({ mode: "rename", name: l.name })
                          }
                        >
                          <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Delete list"
                          className="p-1 rounded hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteList(l);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && deleteList(l)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </span>
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {selected && (
            <div className="rounded-md border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  <span className="font-medium">{assignedCount}</span>{" "}
                  <span className="text-muted-foreground">
                    employee{assignedCount === 1 ? "" : "s"} on this list
                  </span>
                </p>
                <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                  <Users className="h-3.5 w-3.5 mr-1" /> Assign
                </Button>
              </div>
              {!selected.is_default && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  disabled={saving}
                  onClick={() => makeDefault(selected)}
                >
                  Make this the default list
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Anyone not explicitly assigned follows the default list, so nobody is ever without a
                calendar.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT — weekend chooser + calendar */}
        <div className="xl:col-span-9 space-y-4">
          {!selected ? (
            <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>Select a holiday list to build its calendar.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded-md border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  {WEEKDAYS.map((label, day) => (
                    <label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={weekendDraft.includes(day)}
                        onCheckedChange={(checked) =>
                          setWeekendDraft((prev) =>
                            checked ? [...prev, day] : prev.filter((d) => d !== day),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={saving}
                  onClick={saveWeekend}
                >
                  Set Weekend
                </Button>
              </div>

              <div className="rounded-md border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h3 className="text-lg font-medium">
                    {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                    >
                      Today
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Previous month"
                      onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Next month"
                      onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    <div className="grid grid-cols-7 border-b bg-muted/40">
                      {WEEKDAYS.map((label) => (
                        <div
                          key={label}
                          className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {label.slice(0, 3)}
                        </div>
                      ))}
                    </div>

                    {weeks.map((week) => (
                      <div key={toDateKey(week[0])} className="grid grid-cols-7">
                        {week.map((date) => {
                          const key = toDateKey(date);
                          const inMonth = date.getMonth() === month.getMonth();
                          const isWeekend = weekendSet.has(date.getDay());
                          const holiday = listHolidayMap.get(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() =>
                                setDayDialog({
                                  dateKey: key,
                                  name: holiday?.name ?? "",
                                  existing: holiday ?? null,
                                })
                              }
                              className={`min-h-[92px] border-t border-r p-2 text-left align-top transition-colors hover:bg-muted/60 ${
                                inMonth ? "" : "bg-muted/20"
                              }`}
                            >
                              <span
                                className={`block text-right text-sm ${
                                  key === todayKey
                                    ? "font-bold text-primary"
                                    : inMonth
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {date.getDate()}
                              </span>
                              <span className="mt-1 flex flex-col gap-1">
                                {isWeekend && (
                                  <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                                    Weekly Off
                                  </span>
                                )}
                                {holiday && (
                                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white truncate">
                                    {holiday.name}
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Click any date to name a holiday on it. Weekly offs and holidays are never counted
                as absence, and are skipped when someone takes leave across them.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Create / rename */}
      <Dialog open={listDialog !== null} onOpenChange={(open) => !open && setListDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {listDialog?.mode === "create" ? "New Holiday List" : "Rename Holiday List"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Sales Executive Holiday List"
                value={listDialog?.name ?? ""}
                onChange={(e) =>
                  setListDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
                onKeyDown={(e) => e.key === "Enter" && saveList()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setListDialog(null)}>
                Cancel
              </Button>
              <Button onClick={saveList} disabled={saving}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Name a holiday on a date */}
      <Dialog open={dayDialog !== null} onOpenChange={(open) => !open && setDayDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dayDialog
                ? new Date(dayDialog.dateKey).toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Holiday name</Label>
              <Input
                autoFocus
                placeholder="e.g. Rakhi"
                value={dayDialog?.name ?? ""}
                onChange={(e) =>
                  setDayDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
                onKeyDown={(e) => e.key === "Enter" && saveHoliday()}
              />
              <p className="text-xs text-muted-foreground">
                Added to <strong>{selected?.name}</strong> only — other lists are unaffected.
              </p>
            </div>
            <div className="flex justify-between gap-2">
              {dayDialog?.existing ? (
                <Button variant="ghost" className="text-destructive" onClick={removeHoliday}>
                  <Trash2 className="h-4 w-4 mr-1" /> Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDayDialog(null)}>
                  Cancel
                </Button>
                <Button onClick={saveHoliday} disabled={saving}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign employees */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign employees to “{selected?.name}”</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">
              Unticking someone puts them back on the default list. One list per employee — two
              calendars would mean two different answers for the same day.
            </p>
            <div className="rounded-md border divide-y">
              {employees.map((e) => {
                const on = e.holiday_list_id === selected?.id;
                const following =
                  e.holiday_list_id === null && selected?.is_default ? " (via default)" : "";
                const otherList = lists.find((l) => l.id === e.holiday_list_id);
                return (
                  <label
                    key={e.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-3">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) =>
                          assignEmployee(e.id, checked ? (selected?.id ?? null) : null)
                        }
                      />
                      <span className="text-sm">
                        {e.full_name?.trim() || "Unnamed employee"}
                        <span className="text-muted-foreground">{following}</span>
                      </span>
                    </span>
                    {!on && otherList && (
                      <span className="text-xs text-muted-foreground">on “{otherList.name}”</span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setAssignOpen(false)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

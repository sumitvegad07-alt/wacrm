"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  X,
  Check,
  Search,
  GripVertical,
  Trash2,
  Copy,
  Archive,
  Edit2,
  AlertCircle,
  Loader2,
  Table as TableIcon,
  MapPin,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { RouteList } from "@/components/routes/route-list";
import { RouteStatusPill } from "@/components/routes/route-status-pill";
import { cn } from "@/lib/utils";

interface EmployeeRouteTabProps {
  employeeId: string;
  accountId: string;
}

interface RouteItem {
  id: string;
  name: string;
  status: string;
  primary_assignee_id: string | null;
}

interface RouteAssignment {
  id: string;
  route_id: string;
  day_of_week: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  route_name?: string;
  route_status?: string;
}

interface RouteCustomerItem {
  id: string;
  sequence: number;
  route_id: string;
  contact_id: string;
  contacts?: any;
}

interface ContactItem {
  id: string;
  name: string | null;
  company: string | null;
  address: string | null;
}

const DAYS_OF_WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function formatDateStr(year: number, month: number, day: number): string {
  const y = String(year);
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonthGrid(year: number, month: number) {
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstDayOfMonth = new Date(year, month, 1);

  let firstDow = firstDayOfMonth.getDay();
  if (firstDow === 0) firstDow = 7; // 1=Mon .. 7=Sun

  const days: {
    dateStr: string;
    dayNum: number;
    dow: number;
    isCurrentMonth: boolean;
    isToday: boolean;
  }[] = [];

  const todayStr = new Date().toISOString().split("T")[0];

  // Leading days from previous month
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = firstDow - 1; i > 0; i--) {
    const dayNum = prevMonthLastDay - i + 1;
    const dateStr = formatDateStr(year, month - 1, dayNum);
    const d = new Date(year, month - 1, dayNum);
    let dow = d.getDay();
    if (dow === 0) dow = 7;
    days.push({
      dateStr,
      dayNum,
      dow,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  // Current month days
  const numDays = lastDayOfMonth.getDate();
  for (let i = 1; i <= numDays; i++) {
    const dateStr = formatDateStr(year, month, i);
    const d = new Date(year, month, i);
    let dow = d.getDay();
    if (dow === 0) dow = 7;
    days.push({
      dateStr,
      dayNum: i,
      dow,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  // Trailing days from next month
  const rem = days.length % 7;
  if (rem > 0) {
    const needed = 7 - rem;
    for (let i = 1; i <= needed; i++) {
      const dateStr = formatDateStr(year, month + 1, i);
      const d = new Date(year, month + 1, i);
      let dow = d.getDay();
      if (dow === 0) dow = 7;
      days.push({
        dateStr,
        dayNum: i,
        dow,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
      });
    }
  }

  return days;
}

export function EmployeeRouteTab({ employeeId, accountId }: EmployeeRouteTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<"calendar" | "table">("calendar");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [employeeName, setEmployeeName] = useState<string>("Employee");

  // Full screen Route Customers Management Modal state (Screenshot 2)
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);
  const [selectedRouteDate, setSelectedRouteDate] = useState<string | null>(null);
  const [routeCustomers, setRouteCustomers] = useState<RouteCustomerItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [activeSheetTab, setActiveSheetTab] = useState<"overview" | "customers" | "planning" | "history">("customers");

  // Edit route modal state
  const [editRouteModalOpen, setEditRouteModalOpen] = useState(false);
  const [editRouteName, setEditRouteName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Add Route to Day Modal state
  const [addRouteModalOpen, setAddRouteModalOpen] = useState(false);
  const [targetDateStr, setTargetDateStr] = useState<string>("");
  const [targetDow, setTargetDow] = useState<number>(1);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [routeSearch, setRouteSearch] = useState("");
  const [newRouteName, setNewRouteName] = useState("");
  const [creatingRoute, setCreatingRoute] = useState(false);

  // Add Customers Modal state (inside Route Management Screen)
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [availableContacts, setAvailableContacts] = useState<ContactItem[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // Fetch initial data (routes, assignments, profile)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Profile name
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", employeeId)
        .single();
      if (prof?.full_name) setEmployeeName(prof.full_name);

      // All active routes in account
      const { data: routeRows } = await supabase
        .from("routes")
        .select("id, name, status, primary_assignee_id")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("name", { ascending: true });
      const activeRoutes = (routeRows ?? []) as RouteItem[];
      setRoutes(activeRoutes);

      const routeMap = new Map(activeRoutes.map((r) => [r.id, r]));

      // All assignments for this employee
      const { data: assignRows } = await supabase
        .from("route_plan_assignments")
        .select("id, route_id, day_of_week, start_date, end_date, is_active")
        .eq("assignee_id", employeeId)
        .eq("is_active", true);

      const enrichedAssignments = ((assignRows ?? []) as RouteAssignment[]).map((a) => {
        const r = routeMap.get(a.route_id);
        return {
          ...a,
          route_name: r?.name ?? "Route",
          route_status: r?.status ?? "active",
        };
      });

      setAssignments(enrichedAssignments);
    } catch (err: any) {
      toast.error(err.message || "Failed to load monthly route plan");
    } finally {
      setLoading(false);
    }
  }, [supabase, employeeId, accountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch customers for the selected route in Sheet (Screenshot 2)
  const fetchRouteCustomers = useCallback(
    async (routeId: string) => {
      setLoadingCustomers(true);
      try {
        const { data: rcRows, error } = await supabase
          .from("route_customers")
          .select("id, sequence, route_id, contact_id, contacts(id, name, company, address)")
          .eq("route_id", routeId)
          .is("archived_at", null)
          .order("sequence", { ascending: true });

        if (error) throw error;
        setRouteCustomers((rcRows ?? []) as RouteCustomerItem[]);
      } catch (err: any) {
        toast.error(err.message || "Failed to load route customers");
      } finally {
        setLoadingCustomers(false);
      }
    },
    [supabase]
  );

  const openRouteSheet = useCallback(
    (routeId: string, dateStr?: string) => {
      const found = routes.find((r) => r.id === routeId);
      if (found) {
        setSelectedRoute(found);
        setSelectedRouteDate(dateStr || null);
        setActiveSheetTab("customers"); // opens directly to Customers tab as requested
        fetchRouteCustomers(routeId);
      }
    },
    [routes, fetchRouteCustomers]
  );

  // Month navigation
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const jumpToday = () => setCurrentDate(new Date());

  const monthLabel = useMemo(() => {
    return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [currentDate]);

  const daysGrid = useMemo(() => getMonthGrid(year, month), [year, month]);

  // STRICT date matching so a Thursday assignment never automatically repeats on all Thursdays
  const getAssignmentsForDay = useCallback(
    (dateStr: string, dow: number) => {
      return assignments.filter((a) => {
        if (a.start_date && a.end_date) {
          return a.start_date <= dateStr && a.end_date >= dateStr;
        }
        if (a.start_date) {
          return a.start_date === dateStr;
        }
        // Do not automatically match old weekly assignments without dates in Monthly Planner
        return false;
      });
    },
    [assignments]
  );

  // Filtered routes list inside Add Route Modal
  const filteredRoutes = useMemo(() => {
    if (!routeSearch.trim()) return routes;
    const q = routeSearch.toLowerCase().trim();
    return routes.filter((r) => r.name.toLowerCase().includes(q));
  }, [routes, routeSearch]);

  // Open "Assign Route to [Date]" Modal
  const openAddRouteModal = (dateStr: string, dow: number) => {
    setTargetDateStr(dateStr);
    setTargetDow(dow);
    const existing = getAssignmentsForDay(dateStr, dow).map((a) => a.route_id);
    setSelectedRouteIds(existing);
    setRouteSearch("");
    setNewRouteName("");
    setAddRouteModalOpen(true);
  };

  // Save selected multiple routes to that day
  const saveDayAssignments = async () => {
    try {
      const existing = getAssignmentsForDay(targetDateStr, targetDow);
      const existingRouteIds = new Set(existing.map((a) => a.route_id));
      const newRouteIdSet = new Set(selectedRouteIds);

      // Remove unchecked assignments for THIS SPECIFIC DATE
      for (const oldA of existing) {
        if (!newRouteIdSet.has(oldA.route_id)) {
          await supabase.from("route_plan_assignments").delete().eq("id", oldA.id);
        }
      }

      // Add checked assignments that don't already exist on this day
      for (const rId of selectedRouteIds) {
        if (!existingRouteIds.has(rId)) {
          await supabase.from("route_plan_assignments").insert({
            account_id: accountId,
            route_id: rId,
            assignee_id: employeeId,
            day_of_week: targetDow,
            start_date: targetDateStr,
            end_date: targetDateStr,
            is_active: true,
          });
        }
      }

      toast.success("Route assignments updated for " + targetDateStr);
      setAddRouteModalOpen(false);
      await fetchData();

      // If a route was checked, automatically open its Route Management screen
      if (selectedRouteIds.length > 0) {
        const firstId = selectedRouteIds[selectedRouteIds.length - 1];
        openRouteSheet(firstId, targetDateStr);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save route assignments");
    }
  };

  // Create new route securely via RPC (prevents RLS error) and assign immediately
  const handleCreateAndAssignRoute = async () => {
    if (!newRouteName.trim()) {
      toast.error("Please enter a name for the new route");
      return;
    }
    setCreatingRoute(true);
    try {
      const { data: routeRes, error: createErr } = await supabase.rpc("route_upsert", {
        p_route_id: null,
        p_name: newRouteName.trim(),
        p_description: null,
        p_primary_assignee_id: employeeId,
        p_customer_ids: null,
        p_expected_version: null,
      });

      if (createErr || !routeRes) throw createErr || new Error("Failed to create route");

      // Assign to target date
      await supabase.from("route_plan_assignments").insert({
        account_id: accountId,
        route_id: routeRes.id,
        assignee_id: employeeId,
        day_of_week: targetDow,
        start_date: targetDateStr,
        end_date: targetDateStr,
        is_active: true,
      });

      toast.success(`Route "${routeRes.name}" created and assigned to ${targetDateStr}`);
      setNewRouteName("");
      setAddRouteModalOpen(false);
      await fetchData();

      // Open Route Management screen directly as requested
      openRouteSheet(routeRes.id, targetDateStr);
    } catch (err: any) {
      toast.error(err.message || "Failed to create and assign route");
    } finally {
      setCreatingRoute(false);
    }
  };

  // Remove a route assignment from this specific date
  const removeRouteFromDay = async () => {
    if (!selectedRoute || !selectedRouteDate) return;
    try {
      const targetDowNum = new Date(selectedRouteDate).getDay() || 7;
      const existing = getAssignmentsForDay(selectedRouteDate, targetDowNum);
      const matching = existing.find((a) => a.route_id === selectedRoute.id);
      if (matching) {
        await supabase.from("route_plan_assignments").delete().eq("id", matching.id);
        toast.success("Route removed from " + selectedRouteDate);
        setSelectedRoute(null);
        await fetchData();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to remove route");
    }
  };

  // Button actions in Route Management Screen (Screenshot 2)
  const handleApproveRoute = async () => {
    if (!selectedRoute) return;
    try {
      const { error } = await supabase
        .from("routes")
        .update({ status: "active" })
        .eq("id", selectedRoute.id);
      if (error) throw error;
      toast.success(`Route "${selectedRoute.name}" approved and active!`);
      setSelectedRoute({ ...selectedRoute, status: "active" });
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve route");
    }
  };

  const handleArchiveRoute = async () => {
    if (!selectedRoute) return;
    try {
      const { error } = await supabase
        .from("routes")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", selectedRoute.id);
      if (error) throw error;
      toast.success(`Route "${selectedRoute.name}" archived`);
      setSelectedRoute(null);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to archive route");
    }
  };

  const handleCloneRoute = async () => {
    if (!selectedRoute) return;
    try {
      const newName = `${selectedRoute.name} (Copy)`;
      const { data: clonedRoute, error } = await supabase.rpc("route_upsert", {
        p_route_id: null,
        p_name: newName,
        p_description: null,
        p_primary_assignee_id: employeeId,
        p_customer_ids: null,
        p_expected_version: null,
      });
      if (error || !clonedRoute) throw error || new Error("Failed to clone route");

      // Also clone route customers if any exist
      if (routeCustomers.length > 0) {
        for (const rc of routeCustomers) {
          await supabase.from("route_customers").insert({
            account_id: accountId,
            route_id: clonedRoute.id,
            contact_id: rc.contact_id,
            sequence: rc.sequence,
          });
        }
      }

      toast.success(`Route cloned successfully as "${newName}"`);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to clone route");
    }
  };

  const handleOpenEditRouteModal = () => {
    if (!selectedRoute) return;
    setEditRouteName(selectedRoute.name);
    setEditRouteModalOpen(true);
  };

  const handleSaveEditRoute = async () => {
    if (!selectedRoute || !editRouteName.trim()) return;
    setSavingEdit(true);
    try {
      const { data: res, error } = await supabase.rpc("route_upsert", {
        p_route_id: selectedRoute.id,
        p_name: editRouteName.trim(),
        p_description: null,
        p_primary_assignee_id: employeeId,
        p_customer_ids: null,
        p_expected_version: null,
      });
      if (error) throw error;
      toast.success("Route details updated");
      setSelectedRoute({ ...selectedRoute, name: editRouteName.trim() });
      setEditRouteModalOpen(false);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to edit route");
    } finally {
      setSavingEdit(false);
    }
  };

  // Add customer modal search
  const fetchAvailableContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      let q = supabase
        .from("contacts")
        .select("id, name, company, address")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .limit(30);

      if (contactSearch.trim()) {
        q = q.or(`name.ilike.%${contactSearch.trim()}%,company.ilike.%${contactSearch.trim()}%,address.ilike.%${contactSearch.trim()}%`);
      }

      const { data } = await q;
      setAvailableContacts((data ?? []) as ContactItem[]);
    } catch (err: any) {
      toast.error("Failed to load territory contacts");
    } finally {
      setLoadingContacts(false);
    }
  }, [supabase, accountId, contactSearch]);

  useEffect(() => {
    if (addCustomerModalOpen) {
      fetchAvailableContacts();
    }
  }, [addCustomerModalOpen, fetchAvailableContacts]);

  // Add contact to route
  const handleAddCustomerToRoute = async (contactId: string) => {
    if (!selectedRoute) return;
    try {
      const nextSeq = routeCustomers.length + 1;
      const { error } = await supabase.from("route_customers").insert({
        account_id: accountId,
        route_id: selectedRoute.id,
        contact_id: contactId,
        sequence: nextSeq,
      });

      if (error) throw error;
      toast.success("Customer added to route");
      fetchRouteCustomers(selectedRoute.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to add customer");
    }
  };

  // Remove customer from route
  const handleRemoveCustomerFromRoute = async (contactId: string) => {
    if (!selectedRoute) return;
    try {
      const { error } = await supabase
        .from("route_customers")
        .delete()
        .eq("route_id", selectedRoute.id)
        .eq("contact_id", contactId);

      if (error) throw error;
      toast.success("Customer removed from route");
      fetchRouteCustomers(selectedRoute.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to remove customer");
    }
  };

  // Swap customer sequence order
  const moveCustomerSequence = async (index: number, delta: number) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= routeCustomers.length) return;

    const newArr = [...routeCustomers];
    const temp = newArr[index];
    newArr[index] = newArr[targetIndex];
    newArr[targetIndex] = temp;

    setRouteCustomers(newArr);

    try {
      await Promise.all(
        newArr.map((rc, idx) =>
          supabase.from("route_customers").update({ sequence: idx + 1 }).eq("id", rc.id)
        )
      );
      toast.success("Sequence updated");
    } catch {
      toast.error("Failed to reorder sequence");
      if (selectedRoute) fetchRouteCustomers(selectedRoute.id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab("calendar")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            activeSubTab === "calendar"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          Calendar View
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("table")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            activeSubTab === "table"
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <TableIcon className="h-4 w-4" />
          All Routes Table
        </button>
      </div>

      {activeSubTab === "calendar" ? (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Monthly Planner Header (Google Calendar style) */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={jumpToday} className="font-medium">
                Today
              </Button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth} title="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth} title="Next month">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <h2 className="text-xl font-bold text-foreground">{monthLabel}</h2>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-3 py-1">
                Active Routes: {routes.length}
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchData} title="Refresh calendar">
                <Loader2 className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} /> Refresh
              </Button>
            </div>
          </div>

          {/* Monthly Calendar Grid (7 columns Mon..Sun) */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {DAYS_OF_WEEK.map((dow) => (
                <div key={dow} className="px-2 py-3 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {dow}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 divide-x divide-y divide-border">
              {daysGrid.map((cell) => {
                const dayAssignments = getAssignmentsForDay(cell.dateStr, cell.dow);
                return (
                  <div
                    key={cell.dateStr}
                    className={cn(
                      "flex min-h-[140px] flex-col justify-between p-2.5 transition-colors hover:bg-muted/20",
                      !cell.isCurrentMonth && "bg-muted/10 opacity-50"
                    )}
                  >
                    {/* Top: Day number */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          cell.isToday
                            ? "bg-emerald-500 text-white font-bold"
                            : "text-muted-foreground"
                        )}
                      >
                        {cell.dayNum}
                      </span>
                      {dayAssignments.length > 0 && (
                        <span className="text-[10px] text-emerald-400 font-medium">
                          {dayAssignments.length} {dayAssignments.length === 1 ? "route" : "routes"}
                        </span>
                      )}
                    </div>

                    {/* Middle: Route Badges (Emerald Green) */}
                    <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[90px] py-1">
                      {dayAssignments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => openRouteSheet(a.route_id, cell.dateStr)}
                          className="group flex w-full items-center justify-between gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-left text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25"
                          title="Click to view and edit route customers"
                        >
                          <span className="truncate">{a.route_name || "Route"}</span>
                          <span className="shrink-0 text-[10px] text-emerald-400/80 group-hover:text-emerald-200">
                            •
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Bottom: + Add Route button (always available on every tile) */}
                    <button
                      type="button"
                      onClick={() => openAddRouteModal(cell.dateStr, cell.dow)}
                      className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/70 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-400"
                    >
                      <Plus className="h-3 w-3" /> Add Route
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in-50 duration-200">
          <RouteList hideHeader onSelectRoute={(id) => openRouteSheet(id)} />
        </div>
      )}

      {/* ── MODAL: Assign Routes to Date (Wider, Broader, Searchable, RLS Fixed) ── */}
      <Dialog open={addRouteModalOpen} onOpenChange={setAddRouteModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-hidden flex flex-col p-6">
          <DialogHeader className="pb-2 border-b border-border">
            <DialogTitle className="text-xl font-bold text-foreground">
              Assign Routes to <span className="text-emerald-400">{targetDateStr}</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Select one or multiple territory routes to schedule for this specific date.
            </p>
          </DialogHeader>

          {/* Search bar for routes */}
          <div className="pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search routes by name..."
                value={routeSearch}
                onChange={(e) => setRouteSearch(e.target.value)}
                className="pl-9 h-10 text-sm font-medium"
              />
            </div>
          </div>

          {/* Routes Checklist */}
          <div className="flex-1 my-2 overflow-y-auto space-y-2 pr-1 max-h-[42vh]">
            {filteredRoutes.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-muted-foreground">No matching routes found.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try a different search or create a new route below.
                </p>
              </div>
            ) : (
              filteredRoutes.map((r) => {
                const checked = selectedRouteIds.includes(r.id);
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setSelectedRouteIds((prev) =>
                        checked ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                      );
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition-all",
                      checked
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 shadow-sm"
                        : "border-border bg-card hover:bg-muted/60"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{r.name}</span>
                      <RouteStatusPill status={r.status as any} />
                    </div>
                    <div
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                        checked
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {checked && <Check className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Create & Assign New Route Inline */}
          <div className="border-t border-border pt-4">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Or Create & Assign New Route
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="e.g. Kalawad Road Beat"
                value={newRouteName}
                onChange={(e) => setNewRouteName(e.target.value)}
                className="h-10 text-sm font-medium"
              />
              <Button
                size="sm"
                onClick={handleCreateAndAssignRoute}
                disabled={creatingRoute || !newRouteName.trim()}
                className="shrink-0 h-10 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                {creatingRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                Create & Assign
              </Button>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-3 border-t border-border pt-4 mt-2">
            <Button variant="outline" size="sm" onClick={() => setAddRouteModalOpen(false)} className="h-9 px-4">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={saveDayAssignments}
              className="h-9 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            >
              Save Assignments ({selectedRouteIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── FULL SCREEN MODAL: Route Customers Management Screen (Wider, Broader, + Back Button) ── */}
      <Dialog open={!!selectedRoute} onOpenChange={(open) => !open && setSelectedRoute(null)}>
        <DialogContent className="sm:max-w-[1300px] w-[96vw] h-[92vh] max-h-[92vh] flex flex-col p-8 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          {selectedRoute && (
            <div className="flex-1 flex flex-col min-h-0 space-y-6">
              {/* Top Navigation Bar with Back button and Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRoute(null)}
                    className="h-9 px-3 text-muted-foreground hover:text-foreground font-semibold"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Calendar
                  </Button>
                  <div className="h-5 w-px bg-border" />
                  <h2 className="text-2xl font-extrabold text-foreground">{selectedRoute.name}</h2>
                  <RouteStatusPill status={selectedRoute.status as any} />
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 font-semibold px-2.5 py-0.5">
                    Health 100%
                  </Badge>
                  <p className="text-xs text-muted-foreground ml-2">
                    Primary assignee: <span className="font-semibold text-foreground">{employeeName}</span>
                  </p>
                </div>

                {/* Fully Working Action Buttons (Approve, Edit, Archive, Clone, Remove from Day) */}
                <div className="flex items-center gap-2.5">
                  {selectedRoute.status !== "active" && (
                    <Button
                      size="sm"
                      onClick={handleApproveRoute}
                      className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenEditRouteModal}
                    className="h-9 font-medium"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleArchiveRoute}
                    className="h-9 font-medium"
                  >
                    <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCloneRoute}
                    className="h-9 font-medium"
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Clone
                  </Button>
                  {selectedRouteDate && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={removeRouteFromDay}
                      className="h-9 font-medium"
                      title="Remove route assignment from this day"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove from Day
                    </Button>
                  )}
                </div>
              </div>

              {/* Sub-Navigation Tabs */}
              <div className="flex items-center gap-8 border-b border-border text-sm font-semibold">
                {(["overview", "customers", "planning", "history"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveSheetTab(t)}
                    className={cn(
                      "pb-3 capitalize transition-colors border-b-2",
                      activeSheetTab === t
                        ? "border-purple-500 text-foreground font-extrabold"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t === "customers" ? `Customers (${routeCustomers.length})` : t}
                  </button>
                ))}
              </div>

              {/* Customers Tab Content (Exact UI from Screenshot 2, Wider & Broader) */}
              {activeSheetTab === "customers" && (
                <div className="flex-1 flex flex-col min-h-0 space-y-4 overflow-hidden">
                  {/* Top Banner */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-muted-foreground">
                      {routeCustomers.length} customers. Visited top to bottom.
                    </p>
                    <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" className="h-9 font-medium">
                        Select
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setAddCustomerModalOpen(true)}
                        className="h-9 px-4 bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-sm"
                      >
                        <Plus className="h-4 w-4 mr-1.5" /> Add customers
                      </Button>
                    </div>
                  </div>

                  {/* Customer Sequence List */}
                  {loadingCustomers ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading customers...
                    </div>
                  ) : routeCustomers.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 py-16 text-center">
                      <MapPin className="h-10 w-10 text-muted-foreground mb-3" />
                      <p className="text-base font-bold text-foreground">No customers on this route yet</p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                        Click &apos;+ Add customers&apos; above to search and assign customers from your territory.
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto divide-y divide-border rounded-xl border border-border bg-card">
                      {routeCustomers.map((rc, idx) => {
                        const contactName = rc.contacts?.company || rc.contacts?.name || "Unnamed Customer";
                        const address = rc.contacts?.address || rc.contacts?.name || "No address provided";
                        return (
                          <div
                            key={rc.id}
                            className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors group"
                          >
                            <div className="flex items-center gap-5 min-w-0 flex-1">
                              {/* Sequence & Drag handles */}
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="w-7 text-center text-base font-extrabold text-muted-foreground tabular-nums">
                                  {idx + 1}
                                </span>
                                <div className="flex flex-col gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveCustomerSequence(idx, -1)}
                                    disabled={idx === 0}
                                    className="p-1 text-muted-foreground/50 hover:text-foreground disabled:opacity-20"
                                    title="Move Up"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveCustomerSequence(idx, 1)}
                                    disabled={idx === routeCustomers.length - 1}
                                    className="p-1 text-muted-foreground/50 hover:text-foreground disabled:opacity-20"
                                    title="Move Down"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Customer Details */}
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-bold text-foreground truncate">{contactName}</p>
                                <p className="text-sm text-muted-foreground truncate mt-0.5">{address}</p>
                              </div>
                            </div>

                            {/* Remove Customer button */}
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomerFromRoute(rc.contact_id)}
                              className="p-2 text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Remove customer from route"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeSheetTab !== "customers" && (
                <div className="flex-1 flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 p-12 text-center text-sm font-medium text-muted-foreground">
                  {activeSheetTab} details view.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Edit Route Details ── */}
      <Dialog open={editRouteModalOpen} onOpenChange={setEditRouteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Edit Route Name</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Route Name</label>
            <Input
              value={editRouteName}
              onChange={(e) => setEditRouteName(e.target.value)}
              className="h-10 text-sm font-medium"
              placeholder="Enter new route name..."
            />
          </div>
          <DialogFooter className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditRouteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEditRoute}
              disabled={savingEdit || !editRouteName.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Add Customers to Route (Search & Add) ── */}
      <Dialog open={addCustomerModalOpen} onOpenChange={setAddCustomerModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Customers to {selectedRoute?.name}</DialogTitle>
            <p className="text-xs text-muted-foreground">Search and assign territory customers to this route.</p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by company, name, or address..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="pl-9 h-10 text-sm font-medium"
              />
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-xl border border-border">
              {loadingContacts ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading territory contacts...
                </div>
              ) : availableContacts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No matching territory contacts found.</p>
              ) : (
                availableContacts.map((c) => {
                  const alreadyAdded = routeCustomers.some((rc) => rc.contact_id === c.id);
                  const nameStr = c.company || c.name || "Unnamed Contact";
                  const addrStr = c.address || c.name || "No address";
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors">
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-sm font-bold truncate">{nameStr}</p>
                        <p className="text-xs text-muted-foreground truncate">{addrStr}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyAdded ? "outline" : "default"}
                        disabled={alreadyAdded}
                        onClick={() => handleAddCustomerToRoute(c.id)}
                        className="h-8 shrink-0 text-xs font-semibold"
                      >
                        {alreadyAdded ? "Added" : "+ Add"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddCustomerModalOpen(false)} className="h-9 px-5">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

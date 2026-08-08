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
  Trash2,
  Table as TableIcon,
  MapPin,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  ArrowLeft,
  Repeat,
  Loader2,
  CheckSquare,
  Square,
  Save,
  Clock,
  ArrowUpDown,
  Filter,
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
  is_active: boolean; // false = Pending Approval, true = Approved (Live on mobile)
  route_name?: string;
  route_status?: string;
  customer_count?: number;
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
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_FILTER_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatDateStr(year: number, month: number, day: number): string {
  const y = String(year);
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Calculate the first matching proper date in the month for a given day of week (1=Mon..7=Sun)
function getProperDateForDow(dow: number, year: number, month: number): string {
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) break;
    let dayDow = d.getDay();
    if (dayDow === 0) dayDow = 7;
    if (dayDow === dow) {
      return formatDateStr(year, month, day);
    }
  }
  return formatDateStr(year, month, 1);
}

function getDisplayDate(dateStr: string | null, dow: number, year: number, month: number): string {
  if (dateStr) return dateStr;
  return getProperDateForDow(dow, year, month);
}

function getWeekdayName(dateStr: string | null, dow: number): string {
  if (dateStr) {
    const d = new Date(dateStr);
    const dayIndex = d.getDay(); // 0=Sun, 1=Mon...
    return WEEKDAY_NAMES[dayIndex] || "Day";
  }
  const mapDow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return mapDow[dow] || "Day";
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

// Generate repeating dates across a month from startDateStr
function generateRepeatDates(
  startDateStr: string,
  freq: "daily" | "weekly" | "10_days" | "15_days" | "monthly",
  year: number,
  month: number
): string[] {
  const dates: string[] = [];
  const start = new Date(startDateStr);
  const startDay = start.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  let step = 1;
  if (freq === "daily") step = 1;
  else if (freq === "weekly") step = 7;
  else if (freq === "10_days") step = 10;
  else if (freq === "15_days") step = 15;
  else if (freq === "monthly") return [startDateStr];

  for (let day = startDay; day <= lastDayOfMonth; day += step) {
    dates.push(formatDateStr(year, month, day));
  }
  return dates;
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

  // Full screen Route Customers Management state (Screenshot 2)
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);
  const [selectedRouteDate, setSelectedRouteDate] = useState<string | null>(null);
  const [routeCustomers, setRouteCustomers] = useState<RouteCustomerItem[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [savingSequence, setSavingSequence] = useState(false);
  const [activeSheetTab, setActiveSheetTab] = useState<"overview" | "customers" | "planning" | "history">("customers");

  // Repeat route assignment state inside Customer screen
  const [repeatFrequency, setRepeatFrequency] = useState<"daily" | "weekly" | "10_days" | "15_days" | "monthly">("weekly");
  const [repeatApproved, setRepeatApproved] = useState(false);

  // Add Route to Date Modal state
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

  // Table View selection, sorting & filtering state
  const [tableSelectedIds, setTableSelectedIds] = useState<string[]>([]);
  const [tableFilter, setTableFilter] = useState<"all" | "pending" | "approved">("all");
  const [tableSearch, setTableSearch] = useState("");
  const [tableWeekdayFilter, setTableWeekdayFilter] = useState<string>("all");
  const [tableAreaFilter, setTableAreaFilter] = useState<string>("all");
  const [tableSortField, setTableSortField] = useState<"date" | "weekday" | "employee" | "area" | "customers" | "status">("date");
  const [tableSortOrder, setTableSortOrder] = useState<"asc" | "desc">("asc");

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

      // Fetch customer counts for each route
      const { data: rcRows } = await supabase
        .from("route_customers")
        .select("route_id")
        .is("archived_at", null);
      const countsMap = new Map<string, number>();
      (rcRows || []).forEach((row: any) => {
        countsMap.set(row.route_id, (countsMap.get(row.route_id) || 0) + 1);
      });

      // All assignments for this employee (both Pending Approval is_active=false and Approved is_active=true)
      const { data: assignRows } = await supabase
        .from("route_plan_assignments")
        .select("id, route_id, day_of_week, start_date, end_date, is_active")
        .eq("assignee_id", employeeId);

      const enrichedAssignments = ((assignRows ?? []) as RouteAssignment[]).map((a) => {
        const r = routeMap.get(a.route_id);
        return {
          ...a,
          route_name: r?.name ?? "Area Route",
          route_status: r?.status ?? "active",
          customer_count: countsMap.get(a.route_id) || 0,
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

  // Fetch customers for the selected route in Full Screen View
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

  // STRICT single-date matching: never repeats Thursday automatically on other Thursdays
  const getAssignmentsForDay = useCallback(
    (dateStr: string, _dow: number) => {
      return assignments.filter((a) => {
        if (a.start_date && a.end_date) {
          return a.start_date <= dateStr && a.end_date >= dateStr;
        }
        if (a.start_date) {
          return a.start_date === dateStr;
        }
        return false;
      });
    },
    [assignments]
  );

  const pendingAssignments = useMemo(() => {
    return assignments.filter((a) => !a.is_active);
  }, [assignments]);

  // Approve a single assignment (from card pill or table)
  const handleApproveAssignment = async (assignmentId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await supabase
        .from("route_plan_assignments")
        .update({ is_active: true })
        .eq("id", assignmentId);
      toast.success("✓ Route assignment approved! Live on mobile app.");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve assignment");
    }
  };

  // Approve all pending assignments for the month
  const handleApproveAllPending = async () => {
    if (pendingAssignments.length === 0) {
      toast.info("All route assignments for this month are already approved!");
      return;
    }
    const ids = pendingAssignments.map((a) => a.id);
    try {
      await supabase
        .from("route_plan_assignments")
        .update({ is_active: true })
        .in("id", ids);
      toast.success(`✓ Approved all ${ids.length} pending route assignments for the month! Live on mobile.`);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve all assignments");
    }
  };

  // Save Customer Sequence & Approve Route for Mobile (Save & Next Step button at BOTTOM only!)
  const handleSaveSequenceAndApprove = async () => {
    if (!selectedRoute) return;
    setSavingSequence(true);
    try {
      // Re-save sequence order explicitly
      await Promise.all(
        routeCustomers.map((rc, idx) =>
          supabase.from("route_customers").update({ sequence: idx + 1 }).eq("id", rc.id)
        )
      );

      // If opened from a specific date, approve that date's assignment
      if (selectedRouteDate) {
        const matching = assignments.find(
          (a) => a.route_id === selectedRoute.id && a.start_date === selectedRouteDate
        );
        if (matching) {
          await supabase
            .from("route_plan_assignments")
            .update({ is_active: true })
            .eq("id", matching.id);
        }
      }

      toast.success(
        "✓ Saved customer sequence and approved route! Mobile user can see this exact order."
      );
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save sequence");
    } finally {
      setSavingSequence(false);
    }
  };

  // Repeat route schedule across multiple dates in the month
  const handleRepeatSchedule = async () => {
    if (!selectedRoute) return;
    const baseDate = selectedRouteDate || new Date().toISOString().split("T")[0];
    const targetDates = generateRepeatDates(baseDate, repeatFrequency, year, month);
    try {
      let createdCount = 0;
      for (const dStr of targetDates) {
        const dObj = new Date(dStr);
        let dow = dObj.getDay();
        if (dow === 0) dow = 7;

        // Check if already assigned
        const exists = assignments.some(
          (a) => a.route_id === selectedRoute.id && a.start_date === dStr
        );
        if (!exists) {
          await supabase.from("route_plan_assignments").insert({
            account_id: accountId,
            route_id: selectedRoute.id,
            assignee_id: employeeId,
            day_of_week: dow,
            start_date: dStr,
            end_date: dStr,
            is_active: repeatApproved, // true = Approved, false = Pending Approval
          });
          createdCount++;
        }
      }
      toast.success(
        `✓ Scheduled "${selectedRoute.name}" across ${createdCount} dates in ${monthLabel}! (${repeatApproved ? "Approved" : "Pending Approval"})`
      );
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to repeat schedule");
    }
  };

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

  // Save selected multiple routes to that day (as PENDING APPROVAL by default)
  const saveDayAssignments = async () => {
    try {
      const existing = getAssignmentsForDay(targetDateStr, targetDow);
      const existingRouteIds = new Set(existing.map((a) => a.route_id));
      const newRouteIdSet = new Set(selectedRouteIds);

      // Remove unchecked assignments for THIS SPECIFIC DATE ONLY
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
            is_active: false, // Starts as PENDING APPROVAL so manager can review & click Approve
          });
        }
      }

      toast.success(`✓ Assigned areas to ${targetDateStr} (Pending Approval)`);
      setAddRouteModalOpen(false);
      await fetchData();

      if (selectedRouteIds.length > 0) {
        const firstId = selectedRouteIds[selectedRouteIds.length - 1];
        openRouteSheet(firstId, targetDateStr);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save route assignments");
    }
  };

  // Create new area securely via RPC (prevents RLS error) and assign immediately
  const handleCreateAndAssignRoute = async () => {
    if (!newRouteName.trim()) {
      toast.error("Please enter a name for the new area");
      return;
    }
    setCreatingRoute(true);
    try {
      // route_upsert inserts p_route_id straight into routes.id, so passing null overrides the
      // column's gen_random_uuid() default and trips its NOT NULL constraint — creating an area
      // failed every time. The id must be client-generated (also the idempotency convention used
      // everywhere else: the route SDK's saveRoute() takes a required client-side routeId).
      const { data: routeRes, error: createErr } = await supabase.rpc("route_upsert", {
        p_route_id: crypto.randomUUID(),
        p_name: newRouteName.trim(),
        p_description: null,
        p_primary_assignee_id: employeeId,
        p_customer_ids: null,
        p_expected_version: null,
      });

      if (createErr || !routeRes) throw createErr || new Error("Failed to create area");

      await supabase.from("route_plan_assignments").insert({
        account_id: accountId,
        route_id: routeRes.id,
        assignee_id: employeeId,
        day_of_week: targetDow,
        start_date: targetDateStr,
        end_date: targetDateStr,
        is_active: false, // Starts as Pending Approval
      });

      toast.success(`✓ Area "${routeRes.name}" created and assigned to ${targetDateStr} (Pending Approval)`);
      setNewRouteName("");
      setAddRouteModalOpen(false);
      await fetchData();

      openRouteSheet(routeRes.id, targetDateStr);
    } catch (err: any) {
      toast.error(err.message || "Failed to create and assign area");
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
        toast.success("✓ Removed assignment from " + selectedRouteDate);
        setSelectedRoute(null);
        await fetchData();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to remove assignment");
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
      toast.success("Sequence updated. Click 'Save Customer Sequence & Approve' below to make it live!");
    } catch {
      toast.error("Failed to reorder sequence");
      if (selectedRoute) fetchRouteCustomers(selectedRoute.id);
    }
  };

  // ── TABLE VIEW (Exact clone of Calendar schedule with full Filtering, Searching, & Sorting) ──
  const toggleSort = (field: typeof tableSortField) => {
    if (tableSortField === field) {
      setTableSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setTableSortField(field);
      setTableSortOrder("asc");
    }
  };

  const filteredTableAssignments = useMemo(() => {
    let list = assignments;

    // Status filter
    if (tableFilter === "pending") list = list.filter((a) => !a.is_active);
    if (tableFilter === "approved") list = list.filter((a) => a.is_active);

    // Weekday filter
    if (tableWeekdayFilter !== "all") {
      list = list.filter((a) => {
        const w = getWeekdayName(a.start_date, a.day_of_week);
        return w.toLowerCase() === tableWeekdayFilter.toLowerCase();
      });
    }

    // Area filter
    if (tableAreaFilter !== "all") {
      list = list.filter((a) => a.route_id === tableAreaFilter);
    }

    // Text search
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter((a) => {
        const d = getDisplayDate(a.start_date, a.day_of_week, year, month);
        const w = getWeekdayName(a.start_date, a.day_of_week);
        const rn = a.route_name || "";
        return (
          d.toLowerCase().includes(q) ||
          w.toLowerCase().includes(q) ||
          rn.toLowerCase().includes(q) ||
          employeeName.toLowerCase().includes(q)
        );
      });
    }

    // Sorting
    return list.slice().sort((a, b) => {
      let valA = "";
      let valB = "";
      let numA = 0;
      let numB = 0;
      let isNumeric = false;

      if (tableSortField === "date") {
        valA = getDisplayDate(a.start_date, a.day_of_week, year, month);
        valB = getDisplayDate(b.start_date, b.day_of_week, year, month);
      } else if (tableSortField === "weekday") {
        valA = getWeekdayName(a.start_date, a.day_of_week);
        valB = getWeekdayName(b.start_date, b.day_of_week);
      } else if (tableSortField === "employee") {
        valA = employeeName;
        valB = employeeName;
      } else if (tableSortField === "area") {
        valA = a.route_name || "";
        valB = b.route_name || "";
      } else if (tableSortField === "customers") {
        isNumeric = true;
        numA = a.customer_count || 0;
        numB = b.customer_count || 0;
      } else if (tableSortField === "status") {
        valA = a.is_active ? "approved" : "pending";
        valB = b.is_active ? "approved" : "pending";
      }

      if (isNumeric) {
        return tableSortOrder === "asc" ? numA - numB : numB - numA;
      }
      return tableSortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [
    assignments,
    tableFilter,
    tableWeekdayFilter,
    tableAreaFilter,
    tableSearch,
    tableSortField,
    tableSortOrder,
    year,
    month,
    employeeName,
  ]);

  const allTableSelected =
    filteredTableAssignments.length > 0 &&
    tableSelectedIds.length === filteredTableAssignments.length;

  const toggleTableSelectAll = () => {
    if (allTableSelected) {
      setTableSelectedIds([]);
    } else {
      setTableSelectedIds(filteredTableAssignments.map((a) => a.id));
    }
  };

  const toggleTableSelectId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTableSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleTableBulkApprove = async () => {
    if (tableSelectedIds.length === 0) return;
    try {
      await supabase
        .from("route_plan_assignments")
        .update({ is_active: true })
        .in("id", tableSelectedIds);
      toast.success(`✓ Approved ${tableSelectedIds.length} route assignments! Live on mobile.`);
      setTableSelectedIds([]);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Bulk approval failed");
    }
  };

  const handleTableBulkRemove = async () => {
    if (tableSelectedIds.length === 0) return;
    try {
      await supabase
        .from("route_plan_assignments")
        .delete()
        .in("id", tableSelectedIds);
      toast.success(`Removed ${tableSelectedIds.length} assignments from calendar`);
      setTableSelectedIds([]);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Bulk removal failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex items-center gap-2">
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
            Table View (Calendar Clone)
          </button>
        </div>

        {/* Global Approve Month's Routes Button directly in header (ALWAYS VIBRANT & HIGHLIGHTED in BOTH VIEWS!) */}
        <Button
          size="sm"
          onClick={handleApproveAllPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-lg px-5 h-10 border border-emerald-400/40 transition-all hover:scale-105"
        >
          <CheckCircle2 className="h-4 w-4 mr-2 text-white" />
          {pendingAssignments.length > 0
            ? `Approve Month's Routes (${pendingAssignments.length} Pending)`
            : `Approve Month's Routes (All Approved)`}
        </Button>
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

            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-3 py-1 font-semibold">
                ✓ Approved: {assignments.filter((a) => a.is_active).length}
              </Badge>
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-1 font-semibold">
                ⏳ Pending: {pendingAssignments.length}
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
                      "flex min-h-[145px] flex-col justify-between p-2.5 transition-colors hover:bg-muted/20",
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
                          {dayAssignments.length} {dayAssignments.length === 1 ? "area" : "areas"}
                        </span>
                      )}
                    </div>

                    {/* Middle: Route Area Cards (ONLY ICONS FOR APPROVED/PENDING so Route Name has full space!) */}
                    <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[100px] py-1">
                      {dayAssignments.map((a) => (
                        <div
                          key={a.id}
                          className={cn(
                            "group flex w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                            a.is_active
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                              : "border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => openRouteSheet(a.route_id, cell.dateStr)}
                            className="flex-1 min-w-0 truncate text-left"
                            title="Click to view customers & repeat schedule"
                          >
                            <span className="truncate block font-bold">{a.route_name || "Area"}</span>
                          </button>

                          {/* ICONS ONLY for Status on Calendar Tile */}
                          <div className="flex items-center gap-1 shrink-0">
                            {a.is_active ? (
                              <span title="Approved (Live on Mobile)">
                                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                              </span>
                            ) : (
                              <>
                                <span title="Pending Approval">
                                  <Clock className="h-4 w-4 text-amber-300 shrink-0" />
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => handleApproveAssignment(a.id, e)}
                                  className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 shadow transition-colors"
                                  title="Click to Approve for Mobile"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
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
        /* ── TABLE VIEW (Exact Clone of Calendar Schedule with full Sorting, Searching, Weekday/Area Filtering, & NO BLANK DATES) ── */
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {monthLabel} Route Schedule Table
              </h2>
              <p className="text-xs text-muted-foreground">
                Exact table clone of calendar assignments. Click any column header to sort.
              </p>
            </div>

            {/* Filter buttons, dropdowns, & search for Table View */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Status filter chips */}
              <div className="flex rounded-lg border border-border bg-muted/20 p-1">
                {(["all", "pending", "approved"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTableFilter(key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                      tableFilter === key
                        ? "bg-primary text-primary-foreground font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {key === "all" ? `All (${assignments.length})` : key === "pending" ? `Pending (${pendingAssignments.length})` : `Approved (${assignments.filter((a) => a.is_active).length})`}
                  </button>
                ))}
              </div>

              {/* Weekday filter dropdown */}
              <select
                value={tableWeekdayFilter}
                onChange={(e) => setTableWeekdayFilter(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Days</option>
                {WEEKDAY_FILTER_OPTIONS.map((day) => (
                  <option key={day} value={day.toLowerCase()}>
                    {day}
                  </option>
                ))}
              </select>

              {/* Area/Route filter dropdown */}
              <select
                value={tableAreaFilter}
                onChange={(e) => setTableAreaFilter(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Areas ({routes.length})</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              {/* Search bar */}
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search area, date, weekday..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Table Batch Action Bar */}
          {tableSelectedIds.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 animate-in fade-in duration-200">
              <span className="text-sm font-bold text-emerald-300">
                {tableSelectedIds.length} {tableSelectedIds.length === 1 ? "assignment" : "assignments"} selected
              </span>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleTableBulkApprove}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 px-4 shadow-sm"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Approve Selected ({tableSelectedIds.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTableBulkRemove}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-9"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Remove Selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTableSelectedIds([])} className="text-xs">
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* Monthly Schedule Table (Sortable Headers, Native Checkboxes, PROPER DATES) */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={allTableSelected}
                        onChange={toggleTableSelectAll}
                        className="h-4 w-4 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                        aria-label="Select all assignments"
                      />
                    </th>
                    <th
                      className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("date")}
                    >
                      <div className="flex items-center gap-1">
                        Scheduled Date
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "date" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("weekday")}
                    >
                      <div className="flex items-center gap-1">
                        Weekday
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "weekday" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("employee")}
                    >
                      <div className="flex items-center gap-1">
                        Employee Name
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "employee" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("area")}
                    >
                      <div className="flex items-center gap-1">
                        Assigned Area (Route)
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "area" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 font-semibold text-right cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("customers")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Customers
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "customers" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => toggleSort("status")}
                    >
                      <div className="flex items-center gap-1">
                        Approval Status
                        <ArrowUpDown className={cn("h-3.5 w-3.5", tableSortField === "status" && "text-emerald-400")} />
                      </div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredTableAssignments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center">
                        <p className="text-base font-semibold text-foreground">
                          No route assignments match
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Switch to the Calendar View tab to assign areas to dates.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredTableAssignments.map((a) => {
                      const isChecked = tableSelectedIds.includes(a.id);
                      // ALWAYS SHOW PROPER DATE YYYY-MM-DD (No more "Weekly Recurring"!)
                      const displayDate = getDisplayDate(a.start_date, a.day_of_week, year, month);
                      const weekdayName = getWeekdayName(a.start_date, a.day_of_week);

                      return (
                        <tr
                          key={a.id}
                          onClick={() => openRouteSheet(a.route_id, a.start_date || undefined)}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/40",
                            isChecked && "bg-emerald-500/5"
                          )}
                        >
                          <td
                            className="px-4 py-3 text-center"
                            onClick={(e) => toggleTableSelectId(a.id, e)}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="h-4 w-4 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                              aria-label={`Select ${a.route_name}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-bold text-foreground">
                            {displayDate}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-semibold">
                            {weekdayName}
                          </td>
                          <td className="px-4 py-3 font-semibold text-foreground">
                            {employeeName}
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-400">
                            {a.route_name || "Area"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground font-medium">
                            {a.customer_count || 0}
                          </td>
                          <td className="px-4 py-3">
                            {a.is_active ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold">
                                ✓ Approved (Live on Mobile)
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold">
                                ⏳ Pending Approval
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {!a.is_active && (
                                <Button
                                  size="sm"
                                  onClick={() => handleApproveAssignment(a.id)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-8 text-xs shadow"
                                >
                                  <Check className="h-3 w-3 mr-1" /> Approve
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openRouteSheet(a.route_id, a.start_date || undefined)}
                                className="h-8 text-xs font-medium"
                              >
                                View Customers
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
              Select one or multiple territory areas to schedule for this specific date. Starts as Pending Approval.
            </p>
          </DialogHeader>

          {/* Search bar for routes */}
          <div className="pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search areas by name..."
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
                <p className="text-sm font-medium text-muted-foreground">No matching areas found.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try a different search or create a new area below.
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
                    <span className="text-sm font-bold">{r.name}</span>
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

          {/* Create & Assign New Area Inline */}
          <div className="border-t border-border pt-4">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Or Create & Assign New Area
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

      {/* ── FULL SCREEN MODAL: Route Customers & Repeat Scheduler (Wider, Broader, + Back Button, NO Abstract Route Buttons, NO Duplicate Top Button!) ── */}
      <Dialog open={!!selectedRoute} onOpenChange={(open) => !open && setSelectedRoute(null)}>
        <DialogContent className="sm:max-w-[1300px] w-[96vw] h-[92vh] max-h-[92vh] flex flex-col p-8 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          {selectedRoute && (
            <div className="flex-1 flex flex-col min-h-0 space-y-6">
              {/* Top Navigation Bar with Back button and Status Badge (NO duplicate Save & Approve button here!) */}
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
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 font-semibold px-2.5 py-0.5">
                    Health 100%
                  </Badge>
                  <p className="text-xs text-muted-foreground ml-2">
                    Primary assignee: <span className="font-semibold text-foreground">{employeeName}</span>
                  </p>
                </div>

                {/* Top right actions: ONLY Remove from Date and Close (NO duplicate Save button!) */}
                <div className="flex items-center gap-3">
                  {selectedRouteDate && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={removeRouteFromDay}
                      className="h-9 font-medium"
                      title="Remove assignment from this date"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove from {selectedRouteDate}
                    </Button>
                  )}
                </div>
              </div>

              {/* Repeat Route Assignment Section right inside Customer Screen (ALWAYS VISIBLE ON EVERY ROUTE!) */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                <div className="flex items-center gap-3">
                  <Repeat className="h-5 w-5 text-purple-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Repeat &amp; Schedule &quot;{selectedRoute.name}&quot; Across Month
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Select interval starting {selectedRouteDate || new Date().toISOString().split("T")[0]} to auto-schedule across the month.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex rounded-lg border border-border bg-card p-1">
                    {(
                      [
                        { key: "daily", label: "Daily" },
                        { key: "weekly", label: "Weekly" },
                        { key: "10_days", label: "Every 10 Days" },
                        { key: "15_days", label: "Every 15 Days" },
                        { key: "monthly", label: "Monthly" },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setRepeatFrequency(f.key)}
                        className={cn(
                          "rounded-md px-3 py-1 text-xs font-bold transition-colors",
                          repeatFrequency === f.key
                            ? "bg-purple-600 text-white shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setRepeatApproved(!repeatApproved)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {repeatApproved ? (
                      <CheckSquare className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                    Create as Approved
                  </button>

                  <Button
                    size="sm"
                    onClick={handleRepeatSchedule}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold h-9 px-4"
                  >
                    Apply Repeat Schedule
                  </Button>
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
                      {routeCustomers.length} customers. Visited top to bottom. Drag or click arrows to order.
                    </p>
                    <div className="flex items-center gap-3">
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
                      <p className="text-base font-bold text-foreground">No customers assigned to this area yet</p>
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

                  {/* Bottom confirmation Save & Approve button (THE ONE AND ONLY SAVE & APPROVE BUTTON!) */}
                  <div className="flex items-center justify-between border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      Mobile user Dhaval Vegad will see this exact order once approved.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleSaveSequenceAndApprove}
                      disabled={savingSequence}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-6 h-10 shadow-md"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Save Customer Sequence &amp; Approve for Mobile
                    </Button>
                  </div>
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

      {/* ── MODAL: Add Customers to Route (Search & Add) ── */}
      <Dialog open={addCustomerModalOpen} onOpenChange={setAddCustomerModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Customers to {selectedRoute?.name}</DialogTitle>
            <p className="text-xs text-muted-foreground">Search and assign territory customers to this area.</p>
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

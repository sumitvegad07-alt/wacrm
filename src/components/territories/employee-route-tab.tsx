"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Plus, Check, X, ShieldCheck, MapPin, Layers, 
  ArrowUp, ArrowDown, Trash2, Loader2, RefreshCw 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface EmployeeRouteTabProps {
  employeeId: string;
  accountId: string;
}

interface AssignedArea {
  assignment_id: string;
  route_id: string;
  name: string;
  is_active: boolean;
  territory_id?: string;
}

interface DayPlan {
  dateStr: string;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  assignments: AssignedArea[];
}

interface CustomerStop {
  id: string; // route_customer id
  contact_id: string;
  company: string | null;
  name: string | null;
  address: string | null;
  sequence: number;
  route_name: string;
}

export function EmployeeRouteTab({ employeeId, accountId }: EmployeeRouteTabProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [monthPlans, setMonthPlans] = useState<Record<string, AssignedArea[]>>({});
  const [territories, setTerritories] = useState<{ id: string; name: string; level: number }[]>([]);
  
  // Assign Area Modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  // Set Priority Sheet state
  const [prioritySheetOpen, setPrioritySheetOpen] = useState(false);
  const [priorityDateStr, setPriorityDateStr] = useState<string | null>(null);
  const [dayStops, setDayStops] = useState<CustomerStop[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);

  const fetchMonthData = useCallback(async () => {
    if (!accountId || !employeeId) return;
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDay = new Date(year, month, 1).toISOString().split("T")[0];
      const lastDay = new Date(year, month + 1, 0).toISOString().split("T")[0];

      // 1. Fetch territories (level 4 & 5)
      const { data: tData } = await supabase
        .from("territories")
        .select("id, name, level")
        .eq("account_id", accountId)
        .in("level", [4, 5])
        .order("name");
      if (tData) setTerritories(tData);

      // 2. Fetch route plan assignments for this employee in the month range
      const { data: aData, error } = await supabase
        .from("route_plan_assignments")
        .select("id, route_id, start_date, is_active, routes(id, name, description)")
        .eq("assignee_id", employeeId)
        .gte("start_date", firstDay)
        .lte("start_date", lastDay);

      if (error) {
        toast.error("Failed to load route schedule");
        return;
      }

      const map: Record<string, AssignedArea[]> = {};
      if (aData) {
        for (const row of aData) {
          const dateStr = row.start_date;
          if (!dateStr) continue;
          if (!map[dateStr]) map[dateStr] = [];
          const routeName = (row.routes as any)?.name || "Area Route";
          let tId: string | undefined;
          try {
            const desc = JSON.parse((row.routes as any)?.description || "{}");
            tId = desc.territory_id;
          } catch {}

          map[dateStr].push({
            assignment_id: row.id,
            route_id: row.route_id,
            name: routeName,
            is_active: !!row.is_active,
            territory_id: tId,
          });
        }
      }
      setMonthPlans(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [accountId, employeeId, currentDate, supabase]);

  useEffect(() => {
    fetchMonthData();
  }, [fetchMonthData]);

  // Calendar Grid builder
  const buildCalendarDays = (): DayPlan[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 (Sun) - 6 (Sat)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = new Date().toISOString().split("T")[0];

    const days: DayPlan[] = [];

    // Leading days from previous month
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const dNum = prevDaysInMonth - i;
      const d = new Date(year, month - 1, dNum);
      const str = d.toISOString().split("T")[0];
      days.push({
        dateStr: str,
        dayNum: dNum,
        isCurrentMonth: false,
        isToday: str === todayStr,
        assignments: monthPlans[str] || [],
      });
    }

    // Days in current month
    for (let dNum = 1; dNum <= daysInMonth; dNum++) {
      const d = new Date(year, month, dNum);
      const str = d.toISOString().split("T")[0];
      days.push({
        dateStr: str,
        dayNum: dNum,
        isCurrentMonth: true,
        isToday: str === todayStr,
        assignments: monthPlans[str] || [],
      });
    }

    // Trailing days from next month to fill 6 rows (42 boxes)
    const remaining = 42 - days.length;
    for (let dNum = 1; dNum <= remaining; dNum++) {
      const d = new Date(year, month + 1, dNum);
      const str = d.toISOString().split("T")[0];
      days.push({
        dateStr: str,
        dayNum: dNum,
        isCurrentMonth: false,
        isToday: str === todayStr,
        assignments: monthPlans[str] || [],
      });
    }

    return days;
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };
  const handleJumpToday = () => {
    setCurrentDate(new Date());
  };

  const handleApproveMonth = async () => {
    try {
      const allAssignmentIds = Object.values(monthPlans)
        .flat()
        .filter((a) => !a.is_active)
        .map((a) => a.assignment_id);

      if (allAssignmentIds.length === 0) {
        toast.info("All routes in this month are already approved!");
        return;
      }

      const { error } = await supabase
        .from("route_plan_assignments")
        .update({ is_active: true })
        .in("id", allAssignmentIds);

      if (error) throw error;
      toast.success(`Approved ${allAssignmentIds.length} route assignments!`);
      fetchMonthData();
    } catch (err) {
      toast.error("Failed to approve routes");
    }
  };

  const handleOpenAssignModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    setSelectedTerritoryId(territories[0]?.id || "");
    setAssignModalOpen(true);
  };

  const handleAssignTerritory = async () => {
    if (!selectedDateStr || !selectedTerritoryId) return;
    setAssigning(true);
    try {
      const territory = territories.find((t) => t.id === selectedTerritoryId);
      if (!territory) return;

      // 1. Find or create route for this territory
      const { data: routes } = await supabase
        .from("routes")
        .select("id, status")
        .eq("account_id", accountId)
        .eq("name", territory.name);

      let routeId: string;
      if (!routes || routes.length === 0) {
        const { data: newR, error: rErr } = await supabase
          .from("routes")
          .insert({
            account_id: accountId,
            name: territory.name,
            description: JSON.stringify({ type: "area_route", territory_id: territory.id }),
            status: "active",
            created_by: employeeId,
            primary_assignee_id: employeeId,
          })
          .select("id")
          .single();
        if (rErr) throw rErr;
        routeId = newR.id;

        // Sync contacts in this territory to route_customers
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, company, name")
          .eq("account_id", accountId)
          .eq("territory_id", territory.id);

        if (contacts && contacts.length > 0) {
          const rows = contacts.map((c, idx) => ({
            account_id: accountId,
            route_id: routeId,
            contact_id: c.id,
            sequence: idx + 1,
            archived_at: null,
          }));
          await supabase.from("route_customers").insert(rows);
        }
      } else {
        routeId = routes[0].id;
      }

      // 2. Assign to employee for selectedDateStr
      const dow = new Date(selectedDateStr).getDay() || 7;
      const { error: assignErr } = await supabase
        .from("route_plan_assignments")
        .insert({
          account_id: accountId,
          route_id: routeId,
          assignee_id: employeeId,
          day_of_week: dow,
          start_date: selectedDateStr,
          end_date: selectedDateStr,
          is_active: true, // Approved by default when assigned by admin/manager
        });

      if (assignErr) throw assignErr;

      toast.success(`Assigned ${territory.name} to ${selectedDateStr}`);
      setAssignModalOpen(false);
      fetchMonthData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign territory");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId: string, name: string) => {
    try {
      const { error } = await supabase
        .from("route_plan_assignments")
        .delete()
        .eq("id", assignmentId);

      if (error) throw error;
      toast.success(`Removed ${name}`);
      fetchMonthData();
    } catch {
      toast.error("Failed to remove assignment");
    }
  };

  // Open Priority Sheet for a date
  const handleOpenPrioritySheet = async (dateStr: string) => {
    setPriorityDateStr(dateStr);
    setPrioritySheetOpen(true);
    setLoadingStops(true);
    try {
      const assignments = monthPlans[dateStr] || [];
      const routeIds = assignments.map((a) => a.route_id);
      if (routeIds.length === 0) {
        setDayStops([]);
        return;
      }

      const { data: rcs, error } = await supabase
        .from("route_customers")
        .select("id, contact_id, sequence, route_id, contacts(company, name, address)")
        .in("route_id", routeIds)
        .is("archived_at", null)
        .order("sequence");

      if (error) throw error;

      const routeNameMap: Record<string, string> = {};
      assignments.forEach((a) => { routeNameMap[a.route_id] = a.name; });

      const stops: CustomerStop[] = (rcs || []).map((row: any) => ({
        id: row.id,
        contact_id: row.contact_id,
        company: row.contacts?.company || null,
        name: row.contacts?.name || null,
        address: row.contacts?.address || null,
        sequence: row.sequence || 99,
        route_name: routeNameMap[row.route_id] || "Area Route",
      }));

      stops.sort((a, b) => a.sequence - b.sequence);
      setDayStops(stops);
    } catch (err) {
      toast.error("Failed to load customer stops");
    } finally {
      setLoadingStops(false);
    }
  };

  const moveStop = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === dayStops.length - 1) return;

    const targetIdx = direction === "up" ? index - 1 : index + 1;
    const newStops = [...dayStops];
    const [moved] = newStops.splice(index, 1);
    newStops.splice(targetIdx, 0, moved);

    // Re-index sequences
    newStops.forEach((s, idx) => { s.sequence = idx + 1; });
    setDayStops(newStops);
  };

  const handleSavePriority = async () => {
    setSavingPriority(true);
    try {
      for (const s of dayStops) {
        await supabase
          .from("route_customers")
          .update({ sequence: s.sequence })
          .eq("id", s.id);
      }
      toast.success("Customer visit priority updated!");
      setPrioritySheetOpen(false);
    } catch {
      toast.error("Failed to save priority");
    } finally {
      setSavingPriority(false);
    }
  };

  const days = buildCalendarDays();
  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const pendingCount = Object.values(monthPlans)
    .flat()
    .filter((a) => !a.is_active).length;

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border border-border rounded-md bg-background p-1">
            <Button variant="ghost" size="icon" onClick={handlePrevMonth} className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-3 font-semibold text-foreground min-w-[140px] text-center">
              {monthName}
            </span>
            <Button variant="ghost" size="icon" onClick={handleNextMonth} className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleJumpToday}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50 px-3 py-1">
              {pendingCount} Pending Approval
            </Badge>
          )}
          <Button 
            onClick={handleApproveMonth} 
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <ShieldCheck className="w-4 h-4" />
            Approve Month
          </Button>
        </div>
      </div>

      {/* Calendar View */}
      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        {/* Weekday Headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="p-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0 border-border">
              {day}
            </div>
          ))}
        </div>

        {/* Day Cells Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-7 auto-rows-[minmax(140px,_1fr)] divide-x divide-y divide-border">
            {days.map((d, idx) => (
              <div 
                key={`${d.dateStr}-${idx}`}
                className={`flex flex-col justify-between p-2.5 transition-colors ${
                  !d.isCurrentMonth ? "bg-muted/20 opacity-60" : "bg-card hover:bg-muted/10"
                } ${d.isToday ? "ring-2 ring-inset ring-primary/80 bg-primary/5" : ""}`}
              >
                <div>
                  {/* Day Header */}
                  <div className="flex items-center justify-between mb-2">
                    <span 
                      className={`text-sm font-semibold inline-flex items-center justify-center rounded-full w-7 h-7 ${
                        d.isToday 
                          ? "bg-primary text-primary-foreground" 
                          : d.isCurrentMonth 
                          ? "text-foreground" 
                          : "text-muted-foreground"
                      }`}
                    >
                      {d.dayNum}
                    </span>
                    {d.assignments.length > 0 && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {d.assignments.length} {d.assignments.length === 1 ? "area" : "areas"}
                      </span>
                    )}
                  </div>

                  {/* Assigned Areas List */}
                  <div className="space-y-1.5 max-h-[80px] overflow-y-auto pr-1">
                    {d.assignments.map((area) => (
                      <div 
                        key={area.assignment_id}
                        className={`group flex items-center justify-between text-xs px-2 py-1 rounded-md border shadow-2xs ${
                          area.is_active 
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" 
                            : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        <span className="truncate font-medium flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {area.name}
                        </span>
                        <button 
                          onClick={() => handleRemoveAssignment(area.assignment_id, area.name)}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity ml-1 shrink-0"
                          title="Remove Area"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Day Actions Footer */}
                <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-border/50">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleOpenAssignModal(d.dateStr)}
                    className="h-7 px-2 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Assign Area
                  </Button>

                  {d.assignments.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleOpenPrioritySheet(d.dateStr)}
                      className="h-7 px-2 text-[11px] font-medium"
                    >
                      Priority
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Area Modal */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              Assign Area to {selectedDateStr}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Select Territory / Area
              </label>
              <select
                value={selectedTerritoryId}
                onChange={(e) => setSelectedTerritoryId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>-- Choose Area --</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (Level {t.level})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Customers in this territory will automatically be included in the salesman's route for the day.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignTerritory} disabled={assigning || !selectedTerritoryId} className="gap-2">
              {assigning && <Loader2 className="w-4 h-4 animate-spin" />}
              Assign to Day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Priority Sheet */}
      <Sheet open={prioritySheetOpen} onOpenChange={setPrioritySheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              Customer Priority ({priorityDateStr})
            </SheetTitle>
            <SheetDescription>
              Order customer visits for this day. This merged sequence will be displayed on the mobile app.
            </SheetDescription>
          </SheetHeader>

          <div className="py-6 space-y-3">
            {loadingStops ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : dayStops.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                No customers found in the assigned areas for this date.
              </p>
            ) : (
              <div className="space-y-2">
                {dayStops.map((stop, idx) => (
                  <div 
                    key={stop.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card shadow-2xs hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                        {stop.sequence}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {stop.company || stop.name || "Unnamed Contact"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          [{stop.route_name}] {stop.address || "No address"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === 0}
                        onClick={() => moveStop(idx, "up")}
                        className="h-8 w-8"
                        title="Move Up"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={idx === dayStops.length - 1}
                        onClick={() => moveStop(idx, "down")}
                        className="h-8 w-8"
                        title="Move Down"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <Button variant="outline" onClick={() => setPrioritySheetOpen(false)}>
              Close
            </Button>
            <Button onClick={handleSavePriority} disabled={savingPriority || dayStops.length === 0} className="gap-2">
              {savingPriority && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Priority
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

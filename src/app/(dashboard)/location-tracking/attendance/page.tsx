"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, MapPin, Calendar as CalendarIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";

export default function UserAttendancePage() {
  const [activeTab, setActiveTab] = useState("Punch in");
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [usersSummaryData, setUsersSummaryData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  
  const supabase = createClient();

  useEffect(() => {
    fetchAttendance();
  }, [selectedDate]);

  const fetchAttendance = async () => {
    setIsLoading(true);
    
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, avatar_url');

    if (!profiles) {
      setAttendanceData([]);
      setIsLoading(false);
      return;
    }

    const startOfMonth = new Date(selectedDate);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(startOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const { data: monthSessions } = await supabase
      .from('tracking_sessions')
      .select('*')
      .gte('started_at', startOfMonth.toISOString())
      .lte('started_at', endOfMonth.toISOString());

    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const dailySessions = monthSessions?.filter(s => 
      new Date(s.started_at) >= startOfDay && new Date(s.started_at) <= endOfDay
    ) || [];

    const formattedDaily = profiles.map(p => {
      const session = dailySessions.find(s => s.user_id === p.user_id);
      
      let durationStr = "-";
      if (session && session.ended_at) {
        const diffMs = new Date(session.ended_at).getTime() - new Date(session.started_at).getTime();
        const diffMins = Math.round(diffMs / 60000);
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}min`;
      } else if (session) {
        const diffMs = new Date().getTime() - new Date(session.started_at).getTime();
        const diffMins = Math.round(diffMs / 60000);
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}min`;
      }

      return {
        id: p.user_id,
        name: p.full_name || "Unknown",
        rawPunchIn: session ? session.started_at : null,
        rawPunchOut: session?.ended_at || null,
        punchIn: session ? new Date(session.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : "-",
        punchOut: session?.ended_at ? new Date(session.ended_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : "-",
        duration: durationStr,
        status: session ? "Present" : "Absent",
        img: session?.punch_in_photo_url || null
      };
    });
    setAttendanceData(formattedDaily);

    const getWorkingDays = (dateStr: string) => {
      const targetDate = new Date(dateStr);
      const now = new Date();
      if (targetDate.getFullYear() > now.getFullYear() || (targetDate.getFullYear() === now.getFullYear() && targetDate.getMonth() > now.getMonth())) return 0;
      const isCurrentMonth = targetDate.getMonth() === now.getMonth() && targetDate.getFullYear() === now.getFullYear();
      const lastDay = isCurrentMonth ? now.getDate() : new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
      let count = 0;
      for (let i = 1; i <= lastDay; i++) {
          const d = new Date(targetDate.getFullYear(), targetDate.getMonth(), i);
          if (d.getDay() !== 0 && d.getDay() !== 6) count++;
      }
      return count;
    };

    const isLate = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 30);
    };

    const isEarlyLeave = (dateStr: string | null) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getHours() < 18 || (d.getHours() === 18 && d.getMinutes() < 30);
    };

    const totalWorkingDays = getWorkingDays(selectedDate);
    const summaryFormatted = profiles.map(p => {
      const userSessions = monthSessions?.filter(s => s.user_id === p.user_id) || [];
      const uniqueDays = new Set(userSessions.map(s => new Date(s.started_at).toISOString().split('T')[0]));
      const present = uniqueDays.size;
      const absent = Math.max(0, totalWorkingDays - present);
      
      const lateStart = userSessions.filter(s => isLate(s.started_at)).length;
      const earlyLeave = userSessions.filter(s => s.ended_at && isEarlyLeave(s.ended_at)).length;
      const presencePct = totalWorkingDays > 0 ? Math.round((present / totalWorkingDays) * 100) + '%' : '0%';
      
      let shortPresent = 0;
      userSessions.forEach(s => {
          if (s.ended_at) {
              const diffHours = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / (1000 * 60 * 60);
              if (diffHours < 8) shortPresent++;
          }
      });

      return {
        id: p.user_id,
        name: p.full_name || "Unknown",
        totalDays: totalWorkingDays,
        present,
        absent,
        leave: 0,
        holidays: 0,
        presencePct,
        lateStart,
        earlyLeave,
        shortPresent
      };
    });
    setUsersSummaryData(summaryFormatted);

    setIsLoading(false);
  };

  const punchInColumns: ColumnDef<any>[] = [
    {
      id: "name",
      label: "Name",
      type: "text",
      render: (row) => <span className="font-medium">{row.name}</span>
    },
    {
      id: "punchIn",
      label: "Punch in time",
      type: "date",
      render: (row) => <span>{row.punchIn}</span>
    },
    {
      id: "punchOut",
      label: "Punch out time",
      type: "date",
      render: (row) => <span>{row.punchOut}</span>
    },
    {
      id: "duration",
      label: "Duration",
      type: "text",
      render: (row) => <span>{row.duration}</span>
    },
    {
      id: "status",
      label: "Present/Absent",
      type: "select",
      options: [
        { label: "Present", value: "Present" },
        { label: "Absent", value: "Absent" }
      ],
      render: (row) => (
        <Badge variant={row.status === "Present" ? "default" : "destructive"} className={row.status === "Present" ? "bg-green-500 hover:bg-green-600" : ""}>
          {row.status}
        </Badge>
      )
    },
    {
      id: "actions",
      label: "View Map",
      visibleByDefault: true,
      render: (row) => (
        <div className="flex justify-center">
          <Link href="/location-tracking/dashboard" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs whitespace-nowrap">
              <MapPin className="h-3 w-3" /> MAP
            </Button>
          </Link>
        </div>
      )
    },
    {
      id: "img",
      label: "Image",
      type: "text",
      visibleByDefault: true,
      render: (row) => (
        <div className="flex justify-center">
          {row.img ? (
            <Dialog>
              <DialogTrigger className="h-8 w-8 rounded overflow-hidden border border-border inline-flex hover:ring-2 hover:ring-primary transition-all" onClick={(e) => e.stopPropagation()}>
                <img src={row.img} alt="Selfie" className="w-full h-full object-cover" />
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Punch In Selfie - {row.name}</DialogTitle>
                </DialogHeader>
                <div className="flex justify-center p-4">
                  <img src={row.img} alt="Selfie" className="max-w-full rounded-md shadow-lg" />
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <div className="h-8 w-8 rounded border border-border inline-flex items-center justify-center bg-muted">
              <Camera className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      )
    }
  ];

  const usersColumns: ColumnDef<any>[] = [
    {
      id: "name",
      label: "Name",
      type: "text",
      render: (row) => <span className="font-medium whitespace-nowrap">{row.name}</span>
    },
    {
      id: "totalDays",
      label: "Total Days",
      type: "text",
      render: (row) => <span className="text-right block">{row.totalDays}</span>
    },
    {
      id: "present",
      label: "Present Days",
      type: "text",
      render: (row) => <span className="text-right text-green-600 font-medium block">{row.present}</span>
    },
    {
      id: "absent",
      label: "Absent Days",
      type: "text",
      render: (row) => <span className="text-right text-red-500 font-medium block">{row.absent}</span>
    },
    {
      id: "leave",
      label: "Leave Days",
      type: "text",
      render: (row) => <span className="text-right block">{row.leave}</span>
    },
    {
      id: "holidays",
      label: "Holidays",
      type: "text",
      render: (row) => <span className="text-right block">{row.holidays}</span>
    },
    {
      id: "presencePct",
      label: "Presence (%)",
      type: "text",
      render: (row) => <span className="text-right font-medium block">{row.presencePct}</span>
    },
    {
      id: "lateStart",
      label: "Late Start",
      type: "text",
      render: (row) => <span className="text-right block">{row.lateStart}</span>
    },
    {
      id: "earlyLeave",
      label: "Early Leaving",
      type: "text",
      render: (row) => <span className="text-right block">{row.earlyLeave}</span>
    },
    {
      id: "shortPresent",
      label: "Short Present",
      type: "text",
      render: (row) => <span className="text-right block">{row.shortPresent}</span>
    }
  ];

  const filteredPunchData = useMemo(() => {
    return attendanceData.filter(row => {
      if (globalSearch && !row.name.toLowerCase().includes(globalSearch.toLowerCase())) {
        return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "status") {
          if (!(val as string[]).includes(row.status)) return false;
        } else if (colId === "punchIn") {
          if (!isDateInFilter(row.rawPunchIn, val as string | string[])) return false;
        } else if (colId === "punchOut") {
          if (!isDateInFilter(row.rawPunchOut, val as string | string[])) return false;
        }
      }
      return true;
    });
  }, [globalSearch, attendanceData, filterState]);

  const filteredUsersData = useMemo(() => {
    return usersSummaryData.filter(row => {
      if (globalSearch && !row.name.toLowerCase().includes(globalSearch.toLowerCase())) {
        return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [globalSearch, usersSummaryData, filterState]);

  // Reset filter state when changing tabs to avoid applying invalid filters
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setFilterState({});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">User Attendance</h1>
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            className="w-auto h-9"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="border-b border-border flex flex-wrap gap-2 px-4 sm:px-6 shrink-0">
          {["Punch in", "Users", "Days", "Monthly"].map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-0 flex flex-col min-h-0">
          {(activeTab === "Punch in" || activeTab === "Users") && (
            <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-border gap-4 shrink-0">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search by name..." 
                  className="pl-8 bg-background" 
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                />
              </div>
              <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
                Total: {activeTab === "Punch in" ? filteredPunchData.length : filteredUsersData.length}
              </span>
            </div>
          )}

          {activeTab === "Punch in" && (
            <DataTable
              columns={punchInColumns}
              data={filteredPunchData}
              filterState={filterState}
              onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
              storageKey="wacrm_attendance_punch_columns"
              isLoading={isLoading}
              rowKey={(row) => row.id}
            />
          )}

          {activeTab === "Users" && (
            <DataTable
              columns={usersColumns}
              data={filteredUsersData}
              filterState={filterState}
              onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
              storageKey="wacrm_attendance_users_columns"
              isLoading={isLoading}
              rowKey={(row) => row.id}
            />
          )}

          {(activeTab === "Days" || activeTab === "Monthly") && (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[400px]">
              <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-foreground mb-1">Coming Soon</h3>
              <p className="max-w-md mx-auto text-sm">
                The {activeTab} view is currently under construction. Check back soon for detailed chronological attendance reporting.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

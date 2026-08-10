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
import { useAuth } from "@/hooks/use-auth";
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from "@/components/location-tracking/point-map-dialog";
import { DEFAULT_TRACKING, formatHHMM, normalizeTrackingSettings } from "@/lib/location/tracking-window";
import {
  ATTENDANCE_STATUS_OPTIONS,
  attendanceBadges,
  attendanceMatchLabels,
  attendancePrimaryLabel,
  computeAttendanceDay,
  formatWorkedMinutes,
  type AttendanceTone,
} from "@/lib/location/attendance-status";

export default function UserAttendancePage() {
  const { accountId } = useAuth();
  const [activeTab, setActiveTab] = useState("Punch in");
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [usersSummaryData, setUsersSummaryData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [shift, setShift] = useState(DEFAULT_TRACKING);
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  
  const supabase = createClient();

  useEffect(() => {
    fetchAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, accountId]);

  const fetchAttendance = async () => {
    // accountId arrives asynchronously from useAuth; querying before it lands sends id=eq.null.
    if (!accountId) return;
    setIsLoading(true);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, avatar_url');

    if (!profiles) {
      setAttendanceData([]);
      setIsLoading(false);
      return;
    }

    // The company's shift timings. These classify attendance only — they never gate tracking.
    const { data: acct } = await supabase
      .from('accounts')
      .select('settings')
      .eq('id', accountId)
      .maybeSingle();
    const shiftSettings = normalizeTrackingSettings((acct as any)?.settings?.tracking_settings);
    setShift(shiftSettings);

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

    // Punch coordinates are NOT on tracking_sessions — the app records them as location_pings
    // tagged punch_in / punch_out against the session. Sessions from before that tagging existed
    // still have the coordinates, just labelled 'auto', so fall back to the session's first and
    // last point, which is exactly what a punch-in and punch-out ping are.
    const sessionIds = dailySessions.map(s => s.id);
    const { data: punchPings } = sessionIds.length
      ? await supabase
          .from('location_pings')
          .select('session_id, lat, lng, source, recorded_at')
          .in('session_id', sessionIds)
          .order('recorded_at', { ascending: true })
      : { data: [] as any[] };

    const punchBySession: Record<string, { inPt: any; outPt: any }> = {};
    (punchPings || []).forEach((lp: any) => {
      const slot = (punchBySession[lp.session_id] ||= { inPt: null, outPt: null });
      if (lp.source === 'punch_in') slot.inPt ||= lp;
      else if (lp.source === 'punch_out') slot.outPt = lp;
      else {
        // Untagged legacy point: first seen is the punch-in, last seen is the punch-out.
        slot.inPt ||= lp;
        slot.outPt = lp;
      }
    });

    const day = new Date(selectedDate);
    // "--" is the founder's chosen marker for a punch-out that never happened. The system
    // closes the day at midnight in the database, but refuses to print 00:00 as if the rep
    // had chosen it.
    const asTime = (iso: string | null) =>
      iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : "--";

    const formattedDaily = profiles.map(p => {
      // Every session the rep started today, not just the first — a lunch break makes two.
      const userSessions = dailySessions.filter(s => s.user_id === p.user_id);
      const attendance = computeAttendanceDay({
        sessions: userSessions,
        day,
        settings: shiftSettings,
      });

      // The selfie belongs to the first punch-in of the day.
      const ordered = [...userSessions].sort(
        (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      );
      const firstSession = ordered[0];
      const lastSession = ordered[ordered.length - 1];
      const inPt = firstSession ? punchBySession[firstSession.id]?.inPt : null;
      const outPt = lastSession ? punchBySession[lastSession.id]?.outPt : null;

      return {
        id: p.user_id,
        name: p.full_name || "Unknown",
        rawPunchIn: attendance.firstPunchIn,
        rawPunchOut: attendance.lastPunchOut,
        punchIn: asTime(attendance.firstPunchIn),
        punchOut: asTime(attendance.lastPunchOut),
        duration: formatWorkedMinutes(attendance.workedMinutes),
        attendance,
        status: attendancePrimaryLabel(attendance),
        img: firstSession?.punch_in_photo_url || null,
        // Where the rep actually stood when they punched in and out.
        punchInLat: inPt?.lat ?? null,
        punchInLng: inPt?.lng ?? null,
        punchOutLat: outPt?.lat ?? null,
        punchOutLng: outPt?.lng ?? null,
        punchInLatLng: formatLatLng(inPt?.lat, inPt?.lng),
        punchOutLatLng: formatLatLng(outPt?.lat, outPt?.lng),
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

    const totalWorkingDays = getWorkingDays(selectedDate);

    /** Local YYYY-MM-DD. Deliberately not toISOString(), which shifts a late-evening punch-in
     *  into the next day for anyone east of UTC and would mis-bucket the whole month. */
    const localDayKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    const summaryFormatted = profiles.map(p => {
      const userSessions = monthSessions?.filter(s => s.user_id === p.user_id) || [];

      // Group the month's sessions by the day they started on, then classify each day with the
      // same engine the daily tab uses — so the columns here can never disagree with that view.
      const byDay = new Map<string, typeof userSessions>();
      userSessions.forEach(s => {
        const key = localDayKey(s.started_at);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(s);
      });

      let lateStart = 0;
      let earlyLeave = 0;
      let shortPresent = 0;
      let missingPunchOut = 0;
      byDay.forEach(sessions => {
        const d = computeAttendanceDay({
          sessions,
          day: new Date(sessions[0].started_at),
          settings: shiftSettings,
        });
        if (d.flags.includes('missing_punch_out')) missingPunchOut++;
        if (d.flags.includes('late_start')) lateStart++;
        if (d.flags.includes('early_leaving')) earlyLeave++;
        if (d.status === 'short_present') shortPresent++;
      });

      const present = byDay.size;
      const absent = Math.max(0, totalWorkingDays - present);
      const presencePct = totalWorkingDays > 0 ? Math.round((present / totalWorkingDays) * 100) + '%' : '0%';

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
        shortPresent,
        missingPunchOut
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
      id: "punchInLatLng",
      label: "Punch in location",
      type: "text",
      render: (row) => (
        <span className="font-mono text-xs whitespace-nowrap">{row.punchInLatLng}</span>
      )
    },
    {
      id: "punchOutLatLng",
      label: "Punch out location",
      type: "text",
      render: (row) => (
        <span className="font-mono text-xs whitespace-nowrap">{row.punchOutLatLng}</span>
      )
    },
    {
      id: "status",
      label: "Attendance",
      type: "select",
      options: ATTENDANCE_STATUS_OPTIONS,
      render: (row) => (
        // A day can be several things at once (Short Present AND Late Start AND Early Leaving);
        // showing only the first would hide exactly what the admin needs to act on.
        <div className="flex flex-wrap items-center gap-1">
          {attendanceBadges(row.attendance).map((b: { key: string; label: string; tone: AttendanceTone }) => (
            <Badge key={b.key} variant={b.tone}>{b.label}</Badge>
          ))}
        </div>
      )
    },
    {
      id: "actions",
      label: "View Map",
      visibleByDefault: true,
      render: (row) => (
        // Two separate places, so two buttons. One "MAP" link that went to the Live Feed could
        // not have shown either of them.
        <div className="flex justify-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs whitespace-nowrap"
            disabled={!hasPoint(row.punchInLat, row.punchInLng)}
            onClick={(e) => {
              e.stopPropagation();
              setMapPoint({
                lat: row.punchInLat,
                lng: row.punchInLng,
                title: `${row.name} — Punch In`,
                when: row.punchIn,
                label: 'Punch In',
              });
            }}
          >
            <MapPin className="h-3 w-3" /> IN
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs whitespace-nowrap"
            disabled={!hasPoint(row.punchOutLat, row.punchOutLng)}
            onClick={(e) => {
              e.stopPropagation();
              setMapPoint({
                lat: row.punchOutLat,
                lng: row.punchOutLng,
                title: `${row.name} — Punch Out`,
                when: row.punchOut,
                label: 'Punch Out',
              });
            }}
          >
            <MapPin className="h-3 w-3" /> OUT
          </Button>
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
    },
    {
      // Days the rep simply never punched out. Worth its own column: it is a habit to correct,
      // and every one of those days has an unverifiable duration.
      id: "missingPunchOut",
      label: "No Punch Out",
      type: "text",
      render: (row) => (
        <span className={`text-right block ${row.missingPunchOut > 0 ? 'font-semibold text-destructive' : ''}`}>
          {row.missingPunchOut}
        </span>
      )
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
          // Match the status OR any flag, so "Late Start" finds a Present-but-late day too.
          const labels = attendanceMatchLabels(row.attendance);
          if (!(val as string[]).some((v) => labels.includes(v))) return false;
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Attendance</h1>
          {/* Make the rule visible. Without this, "Late Start" is an unexplained accusation. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Measured against the{" "}
            <Link href="/settings" className="text-primary hover:underline">
              configured shift
            </Link>{" "}
            {formatHHMM(shift.start_time)} – {formatHHMM(shift.end_time)}
            {shift.grace_minutes > 0 && <> with {shift.grace_minutes} min grace</>}.
          </p>
        </div>
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

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </div>
  );
}

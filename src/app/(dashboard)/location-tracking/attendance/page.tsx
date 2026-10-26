"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, MapPin, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { PageLayout, PageHeader } from "@/components/shared";
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
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
  LEAVE_DAY_VALUE,
  type AttendanceTone,
} from "@/lib/location/attendance-status";
import { monthWorkingDays, toDateKey } from "@/lib/location/working-days";
import {
  buildAttendanceMatrix,
  buildDayRollup,
  buildMonthlyGrid,
  dayHeading,
  DAY_TYPE_OPTIONS,
  formatDateKey,
  formatMonthKey,
  MONTHLY_LEGEND,
  type DayRollupRow,
  type MonthlyCell,
  type MonthlyRow,
  type RollupInput,
  type RollupSession,
} from "@/lib/location/attendance-rollup";
import { ScreenAccessDenied } from "@/components/location-tracking/screen-access-denied";
import { listApprovedLeaveDays, resolveEmployeeCalendars } from "@/lib/leave/api";
import { matchesColumnFilters } from "@/lib/table/match-filters";
import { cn } from "@/lib/utils";

/** The account's own zone when nothing is configured. Every tenant so far is Indian. */
const FALLBACK_TIMEZONE = "Asia/Kolkata";

const TABS = ["Punch in", "Users", "Days", "Monthly"] as const;
type TabName = (typeof TABS)[number];

/**
 * One saved-column key per tab, so each tab keeps its own filters, column layout and saved
 * views. They cannot be shared: the four tabs do not have a single column in common.
 */
const TABLE_KEYS: Record<TabName, string> = {
  "Punch in": "wacrm_attendance_punch_columns",
  Users: "wacrm_attendance_users_columns",
  Days: "wacrm_attendance_days_columns",
  Monthly: "wacrm_attendance_monthly_columns",
};

/** Cell colours for the month grid, using the same tokens the status badges use. */
const CELL_TONE: Record<AttendanceTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/15 text-info",
  neutral: "bg-muted text-muted-foreground",
};

/** A Monthly row flattened so Export CSV, which reads `row[column.id]`, can see the day cells. */
type MonthlyTableRow = MonthlyRow & { cellByKey: Map<string, MonthlyCell> } & Record<string, unknown>;

const dayColumnId = (dateKey: string) => `d${dateKey.slice(8, 10)}`;

export default function UserAttendancePage() {
  const { accountId, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<TabName>("Punch in");
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState<any[]>([]);
  const [usersSummaryData, setUsersSummaryData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // One hook per tab, keyed by the tab's own table. Each tab therefore keeps its
  // own remembered filters instead of sharing — and switching tabs no longer has
  // to blank the filters by hand to avoid applying one tab's columns to the other.
  const tableView = useTableView(TABLE_KEYS[activeTab], {});
  const { filterState } = tableView;
  const [shift, setShift] = useState(DEFAULT_TRACKING);
  /**
   * Everything the Days and Monthly tabs need, exactly as it came back from the database.
   *
   * They are two more ways of slicing the month this page has already loaded — not another data
   * layer — so nothing extra is fetched for them. Switching to either tab runs no query at all.
   */
  const [rollupSource, setRollupSource] = useState<RollupInput | null>(null);
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

    // `id` is needed as well as `user_id`: sessions key on user_id, but leave_days keys on
    // profiles.id. Those are different columns and mixing them up returns nothing at all.
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, user_id, full_name, avatar_url');

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
    // The account's own zone. Every day in the rollups is bucketed in it, so an Indian tenant's
    // evening punch-in stays on the day it happened instead of sliding onto the next one.
    const rawTimezone = (acct as any)?.settings?.timezone;
    const timezone =
      typeof rawTimezone === "string" && rawTimezone ? rawTimezone : FALLBACK_TIMEZONE;

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

    // Leave and holidays for the whole month, in ONE query each — never one per employee or per
    // day. Only APPROVED leave is fetched: a pending request must not turn a red Absent green.
    const monthFrom = toDateKey(startOfMonth);
    const monthTo = toDateKey(endOfMonth);
    // Weekly offs and holidays are PER EMPLOYEE — they come from the holiday list assigned to
    // each person, because field staff and office staff routinely work different weeks. Both
    // calls fetch the whole month at once, never one query per employee or per day.
    const [approvedLeave, calendars] = await Promise.all([
      listApprovedLeaveDays(accountId, monthFrom, monthTo).catch(() => []),
      resolveEmployeeCalendars(accountId).catch(
        () => new Map<string, { workingDays: number[]; holidays: Map<string, string> }>(),
      ),
    ]);

    const calendarFor = (profileId: string) =>
      calendars.get(profileId) ?? {
        workingDays: shiftSettings.working_days,
        holidays: new Map<string, string>(),
      };
    // Keyed by profile id + date, which is exactly how the day rows are looked up below.
    const leaveByKey = new Map(
      approvedLeave.map(l => [
        `${l.employee_id}|${l.leave_date}`,
        { weightage: l.weightage, typeName: l.leave_type_name },
      ]),
    );

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
      const dayKey = toDateKey(day);
      const calendar = calendarFor(p.id);
      const attendance = computeAttendanceDay({
        sessions: userSessions,
        day,
        settings: shiftSettings,
        workingDays: calendar.workingDays,
        leave: leaveByKey.get(`${p.id}|${dayKey}`) ?? null,
        holidayName: calendar.holidays.get(dayKey) ?? null,
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

    /**
     * The working week used to be hardcoded here as Monday–Friday, which understated Total Days
     * by roughly four a month for the six-day companies this product sells to — and correspondingly
     * overstated everyone's presence. It now comes from the configured working days minus the
     * company's holidays. See src/lib/location/working-days.ts.
     */

    /** Local YYYY-MM-DD. Deliberately not toISOString(), which shifts a late-evening punch-in
     *  into the next day for anyone east of UTC and would mis-bucket the whole month. */
    const localDayKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    // Approved leave per employee for the month, as a sum of day values (a half day counts 0.5).
    const leaveDaysByProfile = new Map<string, number>();
    approvedLeave.forEach(l => {
      const value = LEAVE_DAY_VALUE[l.weightage] ?? 0;
      leaveDaysByProfile.set(l.employee_id, (leaveDaysByProfile.get(l.employee_id) ?? 0) + value);
    });

    const summaryFormatted = profiles.map(p => {
      const userSessions = monthSessions?.filter(s => s.user_id === p.user_id) || [];
      // Each employee is measured against THEIR OWN working week and holiday list.
      const calendar = calendarFor(p.id);
      const employeeSettings = { ...shiftSettings, working_days: calendar.workingDays };
      const holidayKeys = new Set(calendar.holidays.keys());
      const monthTotals = monthWorkingDays(startOfMonth, employeeSettings, holidayKeys);
      const totalWorkingDays = monthTotals.workingDays;

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
        const dayDate = new Date(sessions[0].started_at);
        const key = toDateKey(dayDate);
        const d = computeAttendanceDay({
          sessions,
          day: dayDate,
          settings: employeeSettings,
          leave: leaveByKey.get(`${p.id}|${key}`) ?? null,
          holidayName: calendar.holidays.get(key) ?? null,
        });
        if (d.flags.includes('missing_punch_out')) missingPunchOut++;
        if (d.flags.includes('late_start')) lateStart++;
        if (d.flags.includes('early_leaving')) earlyLeave++;
        if (d.status === 'short_present') shortPresent++;
      });

      const present = byDay.size;
      // Rounded because half days sum in 0.5 steps and raw float arithmetic would otherwise
      // print 24.499999999999996 in an attendance record.
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const leaveDays = round2(leaveDaysByProfile.get(p.id) ?? 0);
      // Leave is neither presence nor absence — it is accounted for separately, so a rep who took
      // approved leave is not left looking absent for those days.
      const absent = round2(Math.max(0, totalWorkingDays - present - leaveDays));
      const presencePct = totalWorkingDays > 0 ? Math.round((present / totalWorkingDays) * 100) + '%' : '0%';

      return {
        id: p.user_id,
        name: p.full_name || "Unknown",
        totalDays: totalWorkingDays,
        present,
        absent,
        leave: leaveDays,
        holidays: monthTotals.holidays,
        presencePct,
        lateStart,
        earlyLeave,
        shortPresent,
        missingPunchOut
      };
    });
    setUsersSummaryData(summaryFormatted);

    // The Days and Monthly tabs work off exactly this — the month's sessions, everyone's own
    // calendar and the approved leave that is already in hand. Handing them the raw rows rather
    // than a second summary is what keeps all four tabs unable to disagree with each other.
    setRollupSource({
      employees: profiles.map(p => {
        const calendar = calendarFor(p.id);
        return {
          profileId: p.id,
          userId: p.user_id,
          name: p.full_name || "Unknown",
          workingDays: calendar.workingDays,
          holidays: calendar.holidays,
        };
      }),
      sessions: (monthSessions ?? []) as RollupSession[],
      leave: approvedLeave,
      settings: shiftSettings,
      timezone,
      fromKey: monthFrom,
      toKey: monthTo,
    });

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
      id: "holidayLabel",
      label: "Holiday Name",
      type: "text",
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">{row.holidayLabel || "-"}</span>
      ),
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

  /**
   * Everyone's every day in the month, classified once.
   *
   * The name search narrows the SET OF PEOPLE first, so the Days tab really does report "across
   * the filtered set of users" rather than filtering rows after the sums are already made.
   */
  const attendanceMatrix = useMemo(() => {
    if (!rollupSource) return null;
    const term = globalSearch.trim().toLowerCase();
    const employees = term
      ? rollupSource.employees.filter(e => e.name.toLowerCase().includes(term))
      : rollupSource.employees;
    return buildAttendanceMatrix({ ...rollupSource, employees });
  }, [rollupSource, globalSearch]);

  const daysData = useMemo(
    () => (attendanceMatrix ? buildDayRollup(attendanceMatrix) : []),
    [attendanceMatrix],
  );

  /**
   * The month grid, flattened.
   *
   * Export CSV reads `row[column.id]`, so each day's letter is copied onto the row under its own
   * column id. The cells themselves stay on the row too, keyed by date, because the grid needs
   * the colour and the full wording that a single letter cannot carry.
   */
  const monthlyData: MonthlyTableRow[] = useMemo(() => {
    if (!attendanceMatrix) return [];
    return buildMonthlyGrid(attendanceMatrix).map(row => {
      const flat = {
        ...row,
        cellByKey: new Map(row.cells.map(c => [c.dateKey, c])),
      } as MonthlyTableRow;
      row.cells.forEach(c => {
        // A day that has not happened yet exports as blank rather than as a dot, which would
        // read as data in a spreadsheet.
        flat[dayColumnId(c.dateKey)] = c.status === "future" ? "" : c.code;
      });
      return flat;
    });
  }, [attendanceMatrix]);

  /** A count that has not been earned yet reads as "-", never as a zero. */
  const countCell = (value: number, row: DayRollupRow, className?: string) =>
    row.isFuture ? (
      <span className="block text-right text-muted-foreground">&mdash;</span>
    ) : (
      <span className={cn("block text-right", className)}>{value}</span>
    );

  const daysColumns: ColumnDef<DayRollupRow>[] = [
    {
      // The id is the row's own field, because Export CSV and the filter matcher both read
      // `row[column.id]` — an id that names no field is a column that exports blank and filters
      // to nothing.
      id: "dateKey",
      label: "Date",
      type: "date",
      render: (row) => (
        <span className={cn("font-medium whitespace-nowrap", row.isFuture && "text-muted-foreground")}>
          {formatDateKey(row.dateKey)}
        </span>
      ),
    },
    {
      id: "weekdayLabel",
      label: "Day",
      type: "select",
      options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
        d => ({ label: d, value: d }),
      ),
      render: (row) => <span className="whitespace-nowrap">{row.weekdayLabel}</span>,
    },
    {
      id: "dayTypeLabel",
      label: "Day Type",
      type: "select",
      options: DAY_TYPE_OPTIONS,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={row.dayType === "working" ? "neutral" : "info"}>{row.dayTypeLabel}</Badge>
          {row.holidayNames.map(name => (
            <Badge key={name} variant="neutral">{name}</Badge>
          ))}
        </div>
      ),
    },
    {
      id: "expected",
      label: "Expected",
      type: "range",
      render: (row) => countCell(row.expected, row),
    },
    {
      id: "present",
      label: "Present",
      type: "range",
      render: (row) => countCell(row.present, row, "font-medium text-success"),
    },
    {
      id: "absent",
      label: "Absent",
      type: "range",
      render: (row) =>
        countCell(row.absent, row, row.absent > 0 ? "font-medium text-destructive" : undefined),
    },
    {
      id: "onLeave",
      label: "On Leave",
      type: "range",
      render: (row) => countCell(row.onLeave, row),
    },
    {
      id: "lateStart",
      label: "Late Start",
      type: "range",
      render: (row) => countCell(row.lateStart, row),
    },
    {
      id: "earlyLeaving",
      label: "Early Leaving",
      type: "range",
      render: (row) => countCell(row.earlyLeaving, row),
    },
    {
      id: "shortPresent",
      label: "Short Present",
      type: "range",
      render: (row) => countCell(row.shortPresent, row),
    },
    {
      id: "missingPunchOut",
      label: "No Punch Out",
      type: "range",
      render: (row) =>
        countCell(
          row.missingPunchOut,
          row,
          row.missingPunchOut > 0 ? "font-semibold text-destructive" : undefined,
        ),
    },
    {
      id: "weeklyOff",
      label: "Weekly Off",
      type: "range",
      render: (row) => countCell(row.weeklyOff, row),
    },
    {
      id: "holiday",
      label: "Holiday",
      type: "range",
      render: (row) => countCell(row.holiday, row),
    },
    {
      id: "presencePct",
      label: "Presence (%)",
      type: "range",
      render: (row) =>
        row.isFuture ? (
          <span className="block text-right text-muted-foreground">&mdash;</span>
        ) : (
          <span className="block text-right font-medium">{row.presencePct}%</span>
        ),
    },
  ];

  /**
   * Name, then one column per day of the month, then the row's totals.
   *
   * Built from the month actually loaded, so February gets 28 columns and never 31 empty ones.
   * The name column is pinned with `sticky left-0`: on a phone the day columns scroll sideways,
   * and a grid whose rows you can no longer attribute to anybody is not worth scrolling.
   */
  const monthlyColumns: ColumnDef<MonthlyTableRow>[] = useMemo(() => {
    const cols: ColumnDef<MonthlyTableRow>[] = [
      {
        id: "name",
        label: "Name",
        type: "text",
        cellClassName: "sticky left-0 z-20 bg-card",
        render: (row) => <span className="font-medium whitespace-nowrap">{row.name}</span>,
      },
    ];

    for (const dateKey of attendanceMatrix?.dayKeys ?? []) {
      const heading = dayHeading(dateKey);
      cols.push({
        id: dayColumnId(dateKey),
        // The weekday goes in the heading too: the date alone would leave the reader counting
        // columns to find Sunday, which is the one they are looking for.
        label: `${heading.dayOfMonth} ${heading.weekdayShort.slice(0, 2)}`,
        cellClassName: "px-0.5 text-center",
        render: (row) => {
          const cell = row.cellByKey.get(dateKey);
          if (!cell) return null;
          const flagged = cell.flags.length > 0;
          return (
            <span
              title={`${formatDateKey(dateKey)} — ${cell.label}`}
              aria-label={`${formatDateKey(dateKey)}: ${cell.label}`}
              className={cn(
                "mx-auto flex size-6 items-center justify-center rounded text-[11px] font-semibold",
                CELL_TONE[cell.tone],
                // A dot as loud as a verdict would make the rest of the month unreadable, so a
                // day that has not happened yet gets no fill at all.
                cell.status === "future" && "bg-transparent text-muted-foreground/50",
                // Something went wrong inside an otherwise fine day — a late start, a missing
                // punch-out. Ringed rather than recoloured, so the verdict's colour survives.
                flagged && "ring-1 ring-inset ring-foreground/30",
              )}
            >
              {cell.code}
            </span>
          );
        },
      });
    }

    cols.push(
      {
        id: "workingDays",
        label: "Working Days",
        type: "range",
        render: (row) => <span className="block text-right">{row.workingDays}</span>,
      },
      {
        id: "present",
        label: "Present",
        type: "range",
        render: (row) => (
          <span className="block text-right font-medium text-success">{row.present}</span>
        ),
      },
      {
        id: "absent",
        label: "Absent",
        type: "range",
        render: (row) => (
          <span className={cn("block text-right", row.absent > 0 && "font-medium text-destructive")}>
            {row.absent}
          </span>
        ),
      },
      {
        id: "leave",
        label: "Leave",
        type: "range",
        render: (row) => <span className="block text-right">{row.leave}</span>,
      },
    );
    return cols;
  }, [attendanceMatrix]);

  // Both new tabs filter through the shared, column-driven matcher rather than a hand-written
  // chain of `if (colId === ...)`. A column that carries a filter type is therefore filtered,
  // full stop — which is what stops a visible control from quietly doing nothing.
  const filteredDaysData = useMemo(
    () => daysData.filter(row => matchesColumnFilters(row, filterState, daysColumns)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [daysData, filterState],
  );

  const filteredMonthlyData = useMemo(
    () => monthlyData.filter(row => matchesColumnFilters(row, filterState, monthlyColumns)),
    [monthlyData, filterState, monthlyColumns],
  );

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

  const handleTabChange = (tab: TabName) => {
    setActiveTab(tab);
  };

  /** How many rows the tab on screen is showing, in its own units. */
  const tabTotal =
    activeTab === "Punch in"
      ? `${filteredPunchData.length} records`
      : activeTab === "Users"
        ? `${filteredUsersData.length} users`
        : activeTab === "Days"
          ? `${filteredDaysData.length} days`
          : `${filteredMonthlyData.length} users`;

  const peopleCounted = attendanceMatrix?.employees.length ?? 0;

  // Direct-URL guard — the sidebar hides this without view_attendance. Owner/admin pass.
  if (!hasPermission("view_attendance")) {
    return <ScreenAccessDenied title="No access to User Attendance" rightLabel="View attendance" />;
  }

  return (
    <PageLayout fill>
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
          {/* Hosts the table's controls, which used to sit on a line of their
              own below this one. */}
          <PageHeader title="User Attendance" className="py-0" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col lg:min-h-0 lg:flex-1">
        <div className="border-b border-border flex flex-wrap gap-2 px-4 sm:px-6 shrink-0">
          {TABS.map((tab) => (
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

        <div className="p-0 flex flex-col min-h-0 lg:flex-1">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border-b border-border gap-3 shrink-0">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                className="pl-8 bg-background"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-col items-start sm:items-end gap-0.5">
              <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
                Total: {tabTotal}
              </span>
              {/* The Days tab counts PEOPLE into each row, so a name search changes the numbers
                  rather than the number of rows. Say so, or the totals look wrong. */}
              {(activeTab === "Days" || activeTab === "Monthly") && rollupSource && (
                <span className="text-xs text-muted-foreground">
                  {formatMonthKey(rollupSource.fromKey)} &middot; {peopleCounted}{" "}
                  {peopleCounted === 1 ? "person" : "people"} &middot; days counted in{" "}
                  {rollupSource.timezone}
                </span>
              )}
            </div>
          </div>

          {activeTab === "Punch in" && (
            <DataTable
              fill
              columns={punchInColumns}
              data={filteredPunchData}
              tableView={tableView}
              isLoading={isLoading}
              rowKey={(row) => row.id}
            />
          )}

          {activeTab === "Users" && (
            <DataTable
              fill
              columns={usersColumns}
              data={filteredUsersData}
              tableView={tableView}
              isLoading={isLoading}
              rowKey={(row) => row.id}
            />
          )}

          {activeTab === "Days" && (
            <DataTable
              fill
              columns={daysColumns}
              data={filteredDaysData}
              tableView={tableView}
              isLoading={isLoading}
              rowKey={(row) => row.dateKey}
              emptyMessage="No days in this month yet."
            />
          )}

          {activeTab === "Monthly" && (
            <>
              {/* The grid shows one letter per day, so the key for those letters has to be on
                  the same screen. Wraps on a phone instead of scrolling away. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-border text-xs text-muted-foreground">
                <span className="font-medium text-foreground">What the letters mean</span>
                {MONTHLY_LEGEND.map((item) => (
                  <span key={item.code} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded text-[11px] font-semibold",
                        CELL_TONE[item.tone],
                      )}
                    >
                      {item.code}
                    </span>
                    {item.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded text-[11px] font-semibold ring-1 ring-inset ring-foreground/30">
                    P
                  </span>
                  A ring means something to look at &mdash; late start, early leaving, no punch out
                </span>
              </div>
              <DataTable
                fill
                columns={monthlyColumns}
                data={filteredMonthlyData}
                tableView={tableView}
                isLoading={isLoading}
                rowKey={(row) => row.profileId}
                emptyMessage="Nobody to show for this month."
              />
            </>
          )}
        </div>
      </div>

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </PageLayout>
  );
}

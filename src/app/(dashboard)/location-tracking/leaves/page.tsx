"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageToolbar, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import type { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { normalizeTrackingSettings, type TrackingSettings } from "@/lib/location/tracking-window";
import {
  listHolidays,
  listLeaveTypes,
  listLeaves,
  summariseDays,
  type Holiday,
  type Leave,
  type LeaveType,
} from "@/lib/leave/api";
import { LeaveFormDialog, type EmployeeOption } from "@/components/leaves/leave-form-dialog";
import { LeaveDetailSheet } from "@/components/leaves/leave-detail-sheet";

const STATUS_TABS = ["All", "Pending", "Approved", "Rejected", "Cancelled"] as const;

export default function LeavesPage() {
  const supabase = createClient();
  const { accountId, profile, accountRole, hasPermission } = useAuth();

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [settings, setSettings] = useState<TrackingSettings>(normalizeTrackingSettings(null));
  const [reportIds, setReportIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [filterState, setFilterState] = useState<FilterState>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Leave | null>(null);
  const [selected, setSelected] = useState<Leave | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const canManageOthers = isAdmin || hasPermission("manage_leaves");
  const canApproveAnyone = isAdmin || hasPermission("approve_leaves");

  const load = useCallback(async () => {
    if (!accountId || !profile?.id) return;
    setLoading(true);
    try {
      const [leaveRows, types, holidayRows, account, employeeRows, reports] = await Promise.all([
        listLeaves(accountId),
        listLeaveTypes(accountId),
        listHolidays(accountId),
        supabase.from("accounts").select("settings").eq("id", accountId).single(),
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("account_id", accountId)
          .order("full_name"),
        // Who reports to me, at any depth. Reused from the reporting hierarchy (migration 106)
        // rather than re-walking the tree here — the database owns that traversal.
        supabase.rpc("get_all_reports", { p_employee_id: profile.id }),
      ]);

      setLeaves(leaveRows);
      setLeaveTypes(types);
      setHolidays(holidayRows);
      setSettings(normalizeTrackingSettings(account.data?.settings?.tracking_settings));
      setEmployees((employeeRows.data ?? []) as EmployeeOption[]);
      setReportIds(new Set(((reports.data as string[] | null) ?? [])));
    } catch {
      toast.error("Could not load leave records");
    } finally {
      setLoading(false);
    }
  }, [accountId, profile?.id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Can the signed-in user approve or reject this particular request? */
  const canDecide = useCallback(
    (leave: Leave) => {
      // A manager may decide for anyone in their downline; an admin or approve_leaves holder for
      // anyone. Nobody but an admin may sign off their own — enforced in the database too.
      const isOwn = leave.employee_id === profile?.id;
      if (isOwn && !isAdmin) return false;
      return canApproveAnyone || reportIds.has(leave.employee_id);
    },
    [canApproveAnyone, reportIds, profile?.id, isAdmin],
  );

  const columns: ColumnDef<Leave>[] = useMemo(
    () => [
      {
        id: "leave_number",
        label: "Leave No.",
        type: "text",
        render: (l) => <span className="font-medium">{l.leave_number}</span>,
      },
      {
        id: "employee",
        label: "Employee",
        type: "text",
        render: (l) => <span>{l.employee?.full_name?.trim() || "-"}</span>,
      },
      {
        id: "leave_type",
        label: "Type",
        type: "select",
        options: leaveTypes.map((t) => ({ label: t.name, value: t.name })),
        render: (l) => (
          <span className="inline-flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: l.leave_type?.color ?? "#64748b" }}
            />
            {l.leave_type?.name ?? "-"}
          </span>
        ),
      },
      {
        id: "from_date",
        label: "From",
        type: "date",
        render: (l) => <span>{format(new Date(l.from_date), "dd MMM, yyyy")}</span>,
      },
      {
        id: "to_date",
        label: "To",
        type: "date",
        render: (l) => <span>{format(new Date(l.to_date), "dd MMM, yyyy")}</span>,
      },
      {
        id: "total_days",
        label: "Days",
        type: "text",
        render: (l) => <span className="font-semibold">{l.total_days}</span>,
      },
      {
        id: "weightage",
        label: "Breakdown",
        type: "text",
        render: (l) => <span className="text-muted-foreground text-sm">{summariseDays(l.days)}</span>,
      },
      {
        id: "reason",
        label: "Reason",
        type: "text",
        render: (l) => (
          <span className="text-sm text-muted-foreground line-clamp-1 max-w-[240px]" title={l.reason}>
            {l.reason}
          </span>
        ),
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: STATUS_TABS.filter((s) => s !== "All").map((s) => ({ label: s, value: s })),
        render: (l) => <StatusBadge status={l.status.toLowerCase()} label={l.status} />,
      },
      {
        id: "created_at",
        label: "Applied On",
        type: "date",
        render: (l) => <span>{format(new Date(l.created_at), "dd MMM, yyyy")}</span>,
      },
    ],
    [leaveTypes],
  );

  const handleFilterChange = (columnId: string, value: unknown) => {
    setFilterState((prev) => ({ ...prev, [columnId]: value }));
  };

  const filtered = useMemo(() => {
    return leaves.filter((l) => {
      for (const [key, value] of Object.entries(filterState)) {
        if (value == null || (Array.isArray(value) && value.length === 0) || value === "") continue;

        if (key === "status" && Array.isArray(value)) {
          if (!value.includes(l.status)) return false;
        } else if (key === "leave_type" && Array.isArray(value)) {
          if (!value.includes(l.leave_type?.name ?? "")) return false;
        } else if (typeof value === "string") {
          const haystack =
            key === "leave_number"
              ? l.leave_number
              : key === "employee"
                ? (l.employee?.full_name ?? "")
                : key === "reason"
                  ? l.reason
                  : "";
          if (haystack && !haystack.toLowerCase().includes(value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [leaves, filterState]);

  const activeStatus = useMemo(() => {
    const value = filterState["status"];
    return Array.isArray(value) && value.length === 1 ? (value[0] as string) : "All";
  }, [filterState]);

  return (
    <PageLayout>
      <PageToolbar
        filters={
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={activeStatus === status ? "default" : "ghost"}
                className="h-7 px-3 text-xs font-medium"
                onClick={() => handleFilterChange("status", status === "All" ? [] : [status])}
              >
                {status}
              </Button>
            ))}
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={filtered}
        actions={
          <Button
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-3 mr-1" /> Apply Leave
          </Button>
        }
        filterState={filterState}
        onFilterChange={handleFilterChange}
        storageKey="wacrm_leaves_table_columns"
        isLoading={loading}
        rowKey={(l) => l.id}
        onRowClick={(l) => {
          setSelected(l);
          setSheetOpen(true);
        }}
      />

      <LeaveFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        leave={editing}
        leaveTypes={leaveTypes}
        employees={employees}
        ownProfileId={profile?.id ?? ""}
        canManageOthers={canManageOthers}
        settings={settings}
        holidays={holidays}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      <LeaveDetailSheet
        leave={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canDecide={selected ? canDecide(selected) : false}
        canManage={canManageOthers}
        isOwn={selected?.employee_id === profile?.id}
        onEdit={(l) => {
          setSheetOpen(false);
          setEditing(l);
          setFormOpen(true);
        }}
        onChanged={() => {
          void load();
          // Keep the open sheet in step with the row that just changed.
          setSelected((prev) => (prev ? { ...prev } : prev));
        }}
      />
    </PageLayout>
  );
}

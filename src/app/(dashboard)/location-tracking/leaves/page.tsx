"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageToolbar, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table/data-table";
import type { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import {
  listLeaveTypes,
  listLeaves,
  resolveEmployeeCalendars,
  summariseDays,
  type Leave,
  type LeaveType,
} from "@/lib/leave/api";
import { LeaveFormDialog, type EmployeeOption } from "@/components/leaves/leave-form-dialog";

const STATUS_TABS = ["All", "Pending", "Approved", "Rejected", "Cancelled"] as const;

export default function LeavesPage() {
  const router = useRouter();
  const supabase = createClient();
  const { accountId, profile, accountRole, hasPermission } = useAuth();

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  // Working days and holidays per employee, from the holiday list assigned to each of them.
  const [calendars, setCalendars] = useState<
    Map<string, { workingDays: number[]; holidays: Map<string, string> }>
  >(new Map());
  const [reportIds, setReportIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [filterState, setFilterState] = useState<FilterState>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Leave | null>(null);

  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const canManageOthers = isAdmin || hasPermission("manage_leaves");
  const canApproveAnyone = isAdmin || hasPermission("approve_leaves");

  const load = useCallback(async () => {
    if (!accountId || !profile?.id) return;
    setLoading(true);
    try {
      const [leaveRows, types, employeeCalendars, employeeRows, reports] = await Promise.all([
        listLeaves(accountId),
        listLeaveTypes(accountId),
        resolveEmployeeCalendars(accountId),
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
      setCalendars(employeeCalendars);
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
        // The record opens as a PAGE, following the order and lead modules — that is where the
        // timeline and its tasks live. A dialog had nowhere to put them.
        onRowClick={(l) => router.push(`/location-tracking/leaves/${l.id}`)}
      />

      <LeaveFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        leave={editing}
        leaveTypes={leaveTypes}
        employees={employees}
        ownProfileId={profile?.id ?? ""}
        canManageOthers={canManageOthers}
        calendars={calendars}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

    </PageLayout>
  );
}

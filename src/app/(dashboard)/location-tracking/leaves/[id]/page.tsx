"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle, Edit2, Loader2, Paperclip, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Timeline } from "@/components/shared/timeline";
import {
  listLeaveTypes,
  resolveEmployeeCalendars,
  updateLeaveStatus,
  weightageLabel,
  type Leave,
  type LeaveType,
} from "@/lib/leave/api";
import { LeaveFormDialog, type EmployeeOption } from "@/components/leaves/leave-form-dialog";

const LEAVE_SELECT =
  "*, leave_type:leave_types(id,name,color), employee:profiles!leaves_employee_id_fkey(id,full_name), days:leave_days(id,leave_date,weightage,day_value,status)";

/**
 * Leave detail — a PAGE, following the house module pattern (see the order and lead detail
 * pages): a header card, a two-column body with the record on the left and the shared
 * <Timeline> on the right. It used to be a dialog, which had no room for tasks or history.
 */
export default function LeaveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { accountId, profile, accountRole, hasPermission } = useAuth();

  const [leave, setLeave] = useState<Leave | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [calendars, setCalendars] = useState<
    Map<string, { workingDays: number[]; holidays: Map<string, string> }>
  >(new Map());
  const [reportIds, setReportIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<"Rejected" | "Cancelled" | null>(null);
  const [reasonText, setReasonText] = useState("");

  const isAdmin = accountRole === "admin" || accountRole === "owner";
  const canManage = isAdmin || hasPermission("manage_leaves");
  const canApproveAnyone = isAdmin || hasPermission("approve_leaves");

  const fetchLeave = useCallback(async () => {
    if (!id || !accountId || !profile?.id) return;
    setLoading(true);
    try {
      const [row, taskRows, activityRows, types, employeeRows, employeeCalendars, reports] =
        await Promise.all([
          supabase.from("leaves").select(LEAVE_SELECT).eq("id", id).maybeSingle(),
          supabase.from("tasks").select("*").eq("leave_id", id).order("created_at", { ascending: false }),
          // module_activities.user_id FKs auth.users, NOT profiles — embedding a profile here
          // returns no rows at all and silently hides the whole timeline. The Timeline component
          // enriches the actor names itself from a separate query.
          supabase
            .from("module_activities")
            .select("*")
            .eq("module_name", "leave")
            .eq("record_id", id)
            .order("created_at", { ascending: false }),
          listLeaveTypes(accountId),
          supabase.from("profiles").select("id, full_name").eq("account_id", accountId).order("full_name"),
          resolveEmployeeCalendars(accountId),
          supabase.rpc("get_all_reports", { p_employee_id: profile.id }),
        ]);

      setLeave((row.data ?? null) as Leave | null);
      setTasks(taskRows.data ?? []);
      setActivities(activityRows.data ?? []);
      setLeaveTypes(types);
      setEmployees((employeeRows.data ?? []) as EmployeeOption[]);
      setCalendars(employeeCalendars);
      setReportIds(new Set((reports.data as string[] | null) ?? []));
    } catch {
      toast.error("Could not load this leave");
    } finally {
      setLoading(false);
    }
  }, [id, accountId, profile?.id, supabase]);

  useEffect(() => {
    void fetchLeave();
  }, [fetchLeave]);

  const runStatusChange = async (
    status: "Approved" | "Rejected" | "Cancelled",
    reason?: string,
  ) => {
    if (!leave) return;
    setBusy(true);
    const result = await updateLeaveStatus(leave.id, status, reason);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Leave ${status.toLowerCase()}`);
    setReasonPrompt(null);
    setReasonText("");
    void fetchLeave();
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading leave...</div>;
  }

  if (!leave) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>This leave could not be found.</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/location-tracking/leaves")}>
          Back to Leaves
        </Button>
      </div>
    );
  }

  const isOwn = leave.employee_id === profile?.id;
  const isPending = leave.status === "Pending";
  const isApproved = leave.status === "Approved";
  // A manager may decide for anyone in their downline; nobody but an admin may sign off their
  // own request. Enforced in the database too — this only decides what to render.
  const canDecide = isOwn && !isAdmin ? false : canApproveAnyone || reportIds.has(leave.employee_id);
  const canCancel = canManage || (isOwn && isPending);
  const canEdit = canManage || (isOwn && isPending);

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push("/location-tracking/leaves")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">{leave.leave_number}</h1>
        <StatusBadge status={leave.status.toLowerCase()} label={leave.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* LEFT — the record */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Field label="Employee" value={leave.employee?.full_name?.trim() || "-"} />
              <Field label="Leave Type" value={leave.leave_type?.name ?? "-"} />
              <Field
                label="Total"
                value={`${leave.total_days} ${Number(leave.total_days) === 1 ? "day" : "days"}`}
              />
              <Field label="From" value={format(new Date(leave.from_date), "dd MMM yyyy")} />
              <Field label="To" value={format(new Date(leave.to_date), "dd MMM yyyy")} />
              <Field
                label="Applied"
                value={format(new Date(leave.created_at), "dd MMM yyyy, h:mm a")}
              />
            </div>

            {leave.is_backdated && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Backdated — applied on the employee&apos;s behalf for a date that had already passed.
              </p>
            )}

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reason</p>
              <p className="text-sm whitespace-pre-wrap">{leave.reason}</p>
            </div>

            {/* The employee needs to see WHY, so a given reason is shown prominently rather than
                buried in the history. It is optional, so this simply does not render when blank. */}
            {leave.status === "Rejected" && leave.rejection_reason && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Reason for rejection
                </p>
                <p className="text-sm">{leave.rejection_reason}</p>
              </div>
            )}
            {leave.status === "Cancelled" && leave.cancellation_reason && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Reason for cancellation
                </p>
                <p className="text-sm">{leave.cancellation_reason}</p>
              </div>
            )}

            {leave.attachment_url && (
              <a
                href={leave.attachment_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Paperclip className="h-4 w-4" />
                {leave.attachment_name || "Attachment"}
              </a>
            )}

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Day breakdown
              </p>
              <div className="rounded-md border divide-y">
                {(leave.days ?? [])
                  .slice()
                  .sort((a, b) => a.leave_date.localeCompare(b.leave_date))
                  .map((d) => (
                    <div key={d.leave_date} className="flex justify-between px-3 py-2 text-sm">
                      <span>{format(new Date(d.leave_date), "EEE, dd MMM yyyy")}</span>
                      <span className="text-muted-foreground">
                        {weightageLabel(d.weightage)} · {d.day_value}
                      </span>
                    </div>
                  ))}
                {(leave.days ?? []).length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No day breakdown recorded.
                  </p>
                )}
              </div>
            </div>

            {reasonPrompt ? (
              <div className="space-y-2 rounded-md border p-3">
                <Label>
                  {reasonPrompt === "Rejected"
                    ? "Reason for rejecting (optional)"
                    : "Reason for cancelling (optional)"}
                </Label>
                <Input
                  autoFocus
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="The employee will see this"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setReasonPrompt(null)}>
                    Back
                  </Button>
                  <Button
                    size="sm"
                    variant={reasonPrompt === "Rejected" ? "destructive" : "default"}
                    disabled={busy}
                    onClick={() => runStatusChange(reasonPrompt, reasonText.trim() || undefined)}
                  >
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Confirm {reasonPrompt === "Rejected" ? "Rejection" : "Cancellation"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {isPending && canDecide && (
                  <>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      disabled={busy}
                      onClick={() => runStatusChange("Approved")}
                    >
                      <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setReasonPrompt("Rejected")}
                    >
                      <XCircle className="h-4 w-4 mr-1.5" /> Reject
                    </Button>
                  </>
                )}
                {canEdit && (isPending || isApproved) && (
                  <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                    <Edit2 className="h-4 w-4 mr-1.5" /> Edit
                  </Button>
                )}
                {canCancel && (isPending || isApproved) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      // Withdrawing your own pending request needs no explanation; cancelling
                      // someone else's offers one, but never demands it.
                      if (isOwn && isPending) void runStatusChange("Cancelled");
                      else setReasonPrompt("Cancelled");
                    }}
                  >
                    {isOwn && isPending ? "Withdraw" : "Cancel Leave"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — the shared timeline: tasks, notes and the change log, exactly as on the
            order and lead detail pages. Never stack it full-width beneath the record. */}
        <div className="lg:col-span-1">
          <Timeline
            moduleName="leave"
            recordId={leave.id}
            tasks={tasks}
            activities={activities}
            onRefresh={fetchLeave}
          />
        </div>
      </div>

      <LeaveFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        leave={leave}
        leaveTypes={leaveTypes}
        employees={employees}
        ownProfileId={profile?.id ?? ""}
        canManageOthers={canManage}
        calendars={calendars}
        onSaved={fetchLeave}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

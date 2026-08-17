"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle, Clock, Edit2, Loader2, Paperclip, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared";
import {
  getLeaveActivity,
  updateLeaveStatus,
  weightageLabel,
  type Leave,
  type LeaveActivity,
} from "@/lib/leave/api";

interface LeaveDetailSheetProps {
  leave: Leave | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the signed-in user may approve or reject THIS request. */
  canDecide: boolean;
  /** Whether they may cancel or edit it. */
  canManage: boolean;
  /** True when this is the signed-in user's own request. */
  isOwn: boolean;
  onEdit: (leave: Leave) => void;
  onChanged: () => void;
}

/** Turn an activity row into a sentence an admin can read at a glance. */
function describeActivity(a: LeaveActivity): string {
  const who = a.actorName?.trim() || "Someone";
  const details = (a.details ?? {}) as Record<string, unknown>;
  const reason = typeof details.reason === "string" ? details.reason : null;
  const changeReason = typeof details.change_reason === "string" ? details.change_reason : null;

  switch (a.action) {
    case "leave_applied":
      return details.on_behalf
        ? `${who} applied on the employee's behalf${details.backdated ? " (backdated)" : ""}`
        : `${who} applied for this leave`;
    case "leave_approved":
      return details.self_approved ? `${who} approved their own leave` : `${who} approved this leave`;
    case "leave_rejected":
      return `${who} rejected this leave${reason ? ` — ${reason}` : ""}`;
    case "leave_cancelled":
      return `${who} cancelled this leave${reason ? ` — ${reason}` : ""}`;
    case "leave_edited":
      return `${who} edited this leave${changeReason ? ` — ${changeReason}` : ""}`;
    default:
      return a.message ?? a.action;
  }
}

export function LeaveDetailSheet({
  leave,
  open,
  onOpenChange,
  canDecide,
  canManage,
  isOwn,
  onEdit,
  onChanged,
}: LeaveDetailSheetProps) {
  const [activity, setActivity] = useState<LeaveActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<"Rejected" | "Cancelled" | null>(null);
  const [reasonText, setReasonText] = useState("");

  const loadActivity = useCallback(async () => {
    if (!leave) return;
    setLoadingActivity(true);
    try {
      setActivity(await getLeaveActivity(leave.id));
    } catch {
      // The record itself is still perfectly readable without its history — don't blank the panel.
      toast.error("Could not load this leave's history");
    } finally {
      setLoadingActivity(false);
    }
  }, [leave]);

  useEffect(() => {
    if (open) void loadActivity();
    else {
      setReasonPrompt(null);
      setReasonText("");
    }
  }, [open, loadActivity]);

  if (!leave) return null;

  const runStatusChange = async (
    status: "Approved" | "Rejected" | "Cancelled",
    reason?: string,
  ) => {
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
    onChanged();
    void loadActivity();
  };

  const isPending = leave.status === "Pending";
  const isApproved = leave.status === "Approved";
  // An employee may withdraw their own request while it is still Pending; beyond that it takes
  // manage rights, and a reason.
  const canCancel = canManage || (isOwn && isPending);
  const canEditThis = canManage || (isOwn && isPending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1400px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {leave.leave_number}
            <StatusBadge status={leave.status.toLowerCase()} label={leave.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 text-sm">
            <Field label="Employee" value={leave.employee?.full_name?.trim() || "-"} />
            <Field label="Leave Type" value={leave.leave_type?.name ?? "-"} />
            <Field label="From" value={format(new Date(leave.from_date), "dd MMM yyyy")} />
            <Field label="To" value={format(new Date(leave.to_date), "dd MMM yyyy")} />
            <Field label="Total" value={`${leave.total_days} ${Number(leave.total_days) === 1 ? "day" : "days"}`} />
            <Field label="Applied" value={format(new Date(leave.created_at), "dd MMM yyyy, h:mm a")} />
          </div>

          {leave.is_backdated && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Backdated — applied on the employee&apos;s behalf for a date that had already passed.
            </p>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reason</p>
            <p className="text-sm whitespace-pre-wrap">{leave.reason}</p>
          </div>

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
                <p className="px-3 py-2 text-sm text-muted-foreground">No day breakdown recorded.</p>
              )}
            </div>
          </div>
          </div>

          {/* Actions */}
          {reasonPrompt ? (
            <div className="space-y-2 rounded-md border p-3">
              <Label>
                {reasonPrompt === "Rejected" ? "Why are you rejecting this?" : "Why are you cancelling this?"}{" "}
                <span className="text-destructive">*</span>
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
                  disabled={busy || !reasonText.trim()}
                  onClick={() => runStatusChange(reasonPrompt, reasonText.trim())}
                >
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Confirm {reasonPrompt === "Rejected" ? "Rejection" : "Cancellation"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
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
              {canEditThis && (isPending || isApproved) && (
                <Button size="sm" variant="outline" onClick={() => onEdit(leave)}>
                  <Edit2 className="h-4 w-4 mr-1.5" /> Edit
                </Button>
              )}
              {canCancel && (isPending || isApproved) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    // An employee withdrawing their own pending request owes nobody an
                    // explanation; anyone cancelling someone else's does.
                    if (isOwn && isPending) void runStatusChange("Cancelled");
                    else setReasonPrompt("Cancelled");
                  }}
                >
                  {isOwn && isPending ? "Withdraw" : "Cancel Leave"}
                </Button>
              )}
            </div>
          )}

          {/* History */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">History</p>
            {loadingActivity ? (
              <p className="text-sm text-muted-foreground">Loading history...</p>
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <Clock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p>{describeActivity(a)}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(a.created_at), "dd MMM yyyy, h:mm a")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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

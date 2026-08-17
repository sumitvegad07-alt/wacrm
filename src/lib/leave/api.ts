/**
 * Leave Management — client data layer.
 *
 * Follows the repo's direct-Supabase pattern (like `src/lib/reporting/api.ts`). Reads are plain
 * PostgREST queries protected by RLS; every WRITE goes through an RPC, because the rules that
 * matter — the past-date restriction, expanding a range into day rows, the overlap check and the
 * audit entry — cannot live in a form. Three separate forms write to these tables and the mobile
 * app writes directly, so a validation that exists only in React does not exist.
 *
 * See `supabase/migrations/20260817170000_leave_management.sql`.
 */

import { createClient } from "@/lib/supabase/client";
import type { LeaveWeightage } from "@/lib/location/attendance-status";

export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

export interface LeaveType {
  id: string;
  account_id: string;
  name: string;
  color: string | null;
  status: "Active" | "Inactive";
}

export interface LeaveDay {
  id?: string;
  leave_date: string;
  weightage: LeaveWeightage;
  day_value: number;
  status?: LeaveStatus;
}

export interface Leave {
  id: string;
  account_id: string;
  employee_id: string;
  leave_number: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  total_days: number;
  reason: string;
  status: LeaveStatus;
  applied_by: string | null;
  is_backdated: boolean;
  attachment_url: string | null;
  attachment_name: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  // Embedded relations
  leave_type?: Pick<LeaveType, "id" | "name" | "color"> | null;
  employee?: { id: string; full_name: string | null } | null;
  days?: LeaveDay[];
}

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
}

export interface LeaveActivity {
  id: string;
  user_id: string | null;
  action: string;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  /** Filled in by a separate profiles lookup — see the note in `getLeaveActivity`. */
  actorName?: string | null;
}

/** The day payload the RPCs expect. */
export interface LeaveDayInput {
  date: string;
  weightage: LeaveWeightage;
}

export type LeaveWriteResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Postgres errors surface as opaque strings. The RPCs already raise human-readable messages, so
 * pass those straight through — but never leak a constraint name or a stack.
 */
function toMessage(error: { message?: string } | null, fallback: string): string {
  const raw = error?.message?.trim();
  if (!raw) return fallback;
  // A raw PostgREST/Postgres internal (rather than one of our RAISE messages) is not for users.
  if (/^(duplicate key|violates|permission denied for|relation |column )/i.test(raw)) return fallback;
  return raw;
}

const LEAVE_SELECT =
  "*, leave_type:leave_types(id,name,color), employee:profiles!leaves_employee_id_fkey(id,full_name), days:leave_days(id,leave_date,weightage,day_value,status)";

/** Every leave the signed-in user is allowed to see. Scoping is enforced by RLS, not here. */
export async function listLeaves(accountId: string): Promise<Leave[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("leaves")
    .select(LEAVE_SELECT)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Leave[];
}

export async function listLeaveTypes(accountId: string, activeOnly = false): Promise<LeaveType[]> {
  const supabase = createClient();
  let query = supabase
    .from("leave_types")
    .select("id, account_id, name, color, status")
    .eq("account_id", accountId)
    .order("name");
  if (activeOnly) query = query.eq("status", "Active");
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LeaveType[];
}

export async function listHolidays(accountId: string): Promise<Holiday[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("id, name, holiday_date")
    .eq("account_id", accountId);
  if (error) throw error;
  return (data ?? []) as Holiday[];
}

/**
 * Approved leave days for a date range, for the attendance page.
 *
 * ONE query for the whole month — never one per employee or per day. Only Approved rows are
 * returned: a pending request must not change how an attendance day reads.
 */
export async function listApprovedLeaveDays(
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<
  { employee_id: string; leave_date: string; weightage: LeaveWeightage; leave_type_name: string | null }[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("leave_days")
    .select("employee_id, leave_date, weightage, leave:leaves!leave_days_leave_id_fkey(leave_type:leave_types(name))")
    .eq("account_id", accountId)
    .eq("status", "Approved")
    .gte("leave_date", fromDate)
    .lte("leave_date", toDate);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const rel = row as unknown as {
      employee_id: string;
      leave_date: string;
      weightage: LeaveWeightage;
      leave?: { leave_type?: { name?: string | null } | null } | null;
    };
    return {
      employee_id: rel.employee_id,
      leave_date: rel.leave_date,
      weightage: rel.weightage,
      leave_type_name: rel.leave?.leave_type?.name ?? null,
    };
  });
}

/**
 * The audit trail for one leave.
 *
 * `module_activities.user_id` FKs **auth.users, not profiles**, so embedding a profile on it
 * returns NO rows and silently hides the whole log. Fetch plainly, then enrich with a separate
 * profiles query — the same shape the lead and order detail pages use.
 */
export async function getLeaveActivity(leaveId: string): Promise<LeaveActivity[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("module_activities")
    .select("id, user_id, action, message, details, created_at")
    .eq("module_name", "leave")
    .eq("record_id", leaveId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as LeaveActivity[];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
  if (userIds.length === 0) return rows;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .in("user_id", userIds);

  const names = new Map((profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]));
  return rows.map((r) => ({ ...r, actorName: r.user_id ? (names.get(r.user_id) ?? null) : null }));
}

export async function createLeaveRequest(input: {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  days: LeaveDayInput[];
  reason: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  leaveId?: string | null;
}): Promise<LeaveWriteResult<Leave>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_leave_request", {
    p_employee_id: input.employeeId,
    p_leave_type_id: input.leaveTypeId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_days: input.days,
    p_reason: input.reason,
    p_attachment_url: input.attachmentUrl ?? null,
    p_attachment_name: input.attachmentName ?? null,
    p_leave_id: input.leaveId ?? null,
  });
  if (error) return { ok: false, message: toMessage(error, "Could not apply for leave") };
  return { ok: true, data: data as Leave };
}

export async function updateLeaveRequest(input: {
  leaveId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  days: LeaveDayInput[];
  reason: string;
  changeReason?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
}): Promise<LeaveWriteResult<Leave>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_leave_request", {
    p_leave_id: input.leaveId,
    p_leave_type_id: input.leaveTypeId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_days: input.days,
    p_reason: input.reason,
    p_change_reason: input.changeReason ?? null,
    p_attachment_url: input.attachmentUrl ?? null,
    p_attachment_name: input.attachmentName ?? null,
  });
  if (error) return { ok: false, message: toMessage(error, "Could not update this leave") };
  return { ok: true, data: data as Leave };
}

export async function updateLeaveStatus(
  leaveId: string,
  newStatus: Exclude<LeaveStatus, "Pending">,
  reason?: string | null,
): Promise<LeaveWriteResult<Leave>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_leave_status", {
    p_leave_id: leaveId,
    p_new_status: newStatus,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false, message: toMessage(error, "Could not update this leave") };
  return { ok: true, data: data as Leave };
}

/** Human label for a weightage, used on the form, the table and the detail panel. */
export const WEIGHTAGE_OPTIONS: { value: LeaveWeightage; label: string; short: string }[] = [
  { value: "full", label: "Full Day", short: "Full" },
  { value: "first_half", label: "First Half", short: "1st Half" },
  { value: "second_half", label: "Second Half", short: "2nd Half" },
  { value: "quarter", label: "Quarter Day", short: "Quarter" },
];

export function weightageLabel(w: LeaveWeightage): string {
  return WEIGHTAGE_OPTIONS.find((o) => o.value === w)?.label ?? w;
}

/**
 * "2 full days, 1 half day" — a one-line summary of a request's day mix for the table, where
 * showing every day would not fit.
 */
export function summariseDays(days: LeaveDay[] | undefined): string {
  if (!days || days.length === 0) return "-";
  const counts = new Map<LeaveWeightage, number>();
  days.forEach((d) => counts.set(d.weightage, (counts.get(d.weightage) ?? 0) + 1));
  return WEIGHTAGE_OPTIONS.filter((o) => counts.has(o.value))
    .map((o) => `${counts.get(o.value)} × ${o.short}`)
    .join(", ");
}

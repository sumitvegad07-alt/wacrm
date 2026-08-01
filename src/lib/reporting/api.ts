// Reporting Hierarchy — client data layer. Follows the repo's direct-Supabase
// pattern; recursive traversal + cycle prevention live in the DB (migration 106).

import { createClient } from '@/lib/supabase/client';

export interface EmployeeOption {
  id: string;
  full_name: string | null;
  email: string;
  status: string | null;
}

const CHECK_VIOLATION = '23514';

export type ReportingWriteResult =
  | { ok: true }
  | { ok: false; reason: 'cycle' | 'error'; message: string };

/** Set/clear an employee's reporting manager + default approver. The DB trigger
 *  rejects cycles (→ friendly 'cycle' result). Admin-gated by profiles RLS. */
export async function updateEmployeeReporting(
  employeeId: string,
  fields: { managerId: string | null; defaultApproverId: string | null }
): Promise<ReportingWriteResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ manager_id: fields.managerId, default_approver_id: fields.defaultApproverId })
    .eq('id', employeeId);
  if (error) {
    if (error.code === CHECK_VIOLATION) return { ok: false, reason: 'cycle', message: error.message };
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true };
}

async function rpcUuidArray(fn: string, employeeId: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, { p_employee_id: employeeId });
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

export const getReportingChain = (employeeId: string) => rpcUuidArray('get_reporting_chain', employeeId);
export const getDirectAndIndirectReports = (employeeId: string) => rpcUuidArray('get_all_reports', employeeId);

/** Resolved approver id (default → reporting chain → null), or null if unresolved. */
export async function getApprover(employeeId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_approver', { p_employee_id: employeeId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Employees in the account (for the manager/approver pickers). */
export async function getAccountEmployees(accountId: string, excludeId?: string): Promise<EmployeeOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, status')
    .eq('account_id', accountId)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as EmployeeOption[]).filter((e) => e.id !== excludeId);
}

/** Resolve the approver AND fetch their display name — for the expense screen. */
export async function getApproverProfile(
  employeeId: string
): Promise<{ id: string; full_name: string | null; email: string } | null> {
  const approverId = await getApprover(employeeId);
  if (!approverId) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', approverId)
    .maybeSingle();
  return (data as { id: string; full_name: string | null; email: string } | null) ?? null;
}

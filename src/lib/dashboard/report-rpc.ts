import type { SupabaseClient } from "@supabase/supabase-js";

// Thin wrapper over the execute_report RPC, shared by the SFA / WFA / CRM
// analytics server actions. execute_report is SECURITY INVOKER, so every call
// runs under the caller's RLS — analytics respect the viewer's data scope
// automatically. On any RPC error we log and return [] so one failing matrix
// never takes down the whole dashboard bundle.

export type ReportRow = Record<string, unknown>;

export async function runReport(
  supabase: SupabaseClient,
  accountId: string,
  module: string,
  dimensions: string[],
  measures: string[],
  filters: Record<string, unknown>,
  sortColumn?: string,
  limit?: number,
): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("execute_report", {
    p_account_id: accountId,
    p_module: module,
    p_dimensions: dimensions,
    p_measures: measures,
    p_filters: filters,
    p_sort_column: sortColumn ?? null,
    p_sort_direction: "desc",
    p_limit: limit ?? null,
    p_offset: 0,
  });
  if (error) {
    console.error(`[analytics] ${module} report failed:`, error.message);
    return [];
  }
  return (data ?? []) as ReportRow[];
}

export const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
export const str = (v: unknown): string => (v == null ? "" : String(v));

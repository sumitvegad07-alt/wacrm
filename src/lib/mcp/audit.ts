// ============================================================
// The audit log. Every tool call writes exactly one row.
//
// Two reasons this is non-negotiable. A leaked bearer token is the primary
// risk of the whole feature, and this is the only way it would ever be
// noticed. Second, it answers "which module do we expose next?" with real
// demand data instead of a guess.
//
// Written through the service-role client, because the log is ours rather
// than the tenant's and must be written even when the tenant-facing call
// failed — including when it failed because the tenant's own session was
// rejected.
// ============================================================
import { supabaseAdmin } from "@/lib/flows/admin-client";

export interface McpCallLogEntry {
  connectionId: string | null;
  accountId: string;
  profileId: string | null;
  clientName: string | null;
  tool: string;
  dataSet?: string;
  rowCount?: number;
  truncated?: boolean;
  durationMs?: number;
  errorCode?: string;
}

/**
 * Record one tool call. Never throws: a failed audit write must not turn a
 * working answer into an error for the admin. A write that fails is logged
 * to the server console so it is still visible in Vercel's logs.
 */
export async function logCall(entry: McpCallLogEntry): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { error } = await db.from("mcp_call_log").insert({
      connection_id: entry.connectionId,
      account_id: entry.accountId,
      profile_id: entry.profileId,
      client_name: entry.clientName,
      tool: entry.tool,
      data_set: entry.dataSet ?? null,
      row_count: entry.rowCount ?? null,
      truncated: entry.truncated ?? false,
      duration_ms: entry.durationMs ?? null,
      error_code: entry.errorCode ?? null,
    });
    if (error) {
      console.error("[mcp] audit write failed:", error.message, {
        tool: entry.tool,
        dataSet: entry.dataSet,
      });
    }
  } catch (err) {
    console.error("[mcp] audit write threw:", err);
  }
}

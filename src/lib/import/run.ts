import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommitRow, ImportDescriptor, ImportMode, ValidationSummary } from "./types";
import { normalizeKey } from "./parse";

const CHUNK_SIZE = 500;

/** Load the existing dedupe-key set for a module, scoped to the account. Used by
 *  the preview step to flag duplicates before any write. */
export async function loadExistingKeys(
  supabase: SupabaseClient,
  descriptor: ImportDescriptor,
  accountId: string,
): Promise<Set<string>> {
  const cols = descriptor.dedupeKeys.join(",");
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(descriptor.targetTable)
      .select(cols)
      .eq("account_id", accountId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) {
      const parts = descriptor.dedupeKeys.map((k) => normalizeKey(String(row[k] ?? "")));
      if (parts.every((p) => p !== "")) keys.add(parts.join("|"));
    }
    if (rows.length < PAGE) break;
  }
  return keys;
}

export interface CreateJobArgs {
  accountId: string;
  userId: string;
  descriptor: ImportDescriptor;
  fileName: string;
  fileSize: number;
  sourceFormat: "csv" | "xlsx";
  mode: ImportMode;
  mapping: Record<string, string>;
  summary: ValidationSummary;
}

/** Insert the import_jobs audit row (status 'previewed') and return its id. */
export async function createImportJob(supabase: SupabaseClient, args: CreateJobArgs): Promise<string> {
  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      module: args.descriptor.module,
      target_table: args.descriptor.targetTable,
      file_name: args.fileName,
      file_size: args.fileSize,
      source_format: args.sourceFormat,
      mode: args.mode,
      status: "previewed",
      total_rows: args.summary.total,
      valid_rows: args.summary.valid,
      invalid_rows: args.summary.invalid,
      duplicate_rows: args.summary.duplicate,
      mapping: args.mapping,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface CommitResult {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * Commit rows to the server in chunks via the idempotent import_commit RPC.
 * `onProgress` reports rows sent so the UI can show a live bar. The final chunk
 * carries p_final=true, which marks the job completed and opens the undo window.
 */
export async function commitInChunks(
  supabase: SupabaseClient,
  jobId: string,
  rows: CommitRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<CommitResult> {
  const total = rows.length;
  const agg: CommitResult = { imported: 0, updated: 0, skipped: 0, failed: 0 };

  if (total === 0) {
    // Nothing to send, but still finalise the job so status/undo are consistent.
    const { error } = await supabase.rpc("import_commit", { p_job_id: jobId, p_rows: [], p_final: true });
    if (error) throw error;
    return agg;
  }

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const isFinal = i + CHUNK_SIZE >= total;
    const { data, error } = await supabase.rpc("import_commit", {
      p_job_id: jobId,
      p_rows: chunk,
      p_final: isFinal,
    });
    if (error) throw error;
    const res = (data ?? {}) as Partial<CommitResult>;
    agg.imported += res.imported ?? 0;
    agg.updated += res.updated ?? 0;
    agg.skipped += res.skipped ?? 0;
    agg.failed += res.failed ?? 0;
    onProgress?.(Math.min(i + CHUNK_SIZE, total), total);
  }
  return agg;
}

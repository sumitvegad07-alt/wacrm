import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading a quotation's version history.
 *
 * Versioning always wrote the links — `parent_id`, an incremented `version`,
 * and `is_latest_version` flipped off on the parent — but nothing ever read
 * them back. The list screen shows only the latest version, so the moment v2
 * existed, v1 was unreachable from anywhere in the product. The founder's words
 * (2026-10-12): "I can't see older version from that newer version."
 */

/** One row of a quotation's version chain, as `quotation_version_chain` returns it. */
export interface QuotationVersion {
  id: string;
  quotation_number: string;
  version: number;
  status: string;
  date: string;
  total_amount: number | null;
  is_latest_version: boolean | null;
  is_active: boolean | null;
  parent_id: string | null;
  created_at: string;
}

/**
 * The newest version in a chain.
 *
 * Prefers the highest `version` over the `is_latest_version` flag. The flag is
 * written in a second statement after the new version is inserted, so a failed
 * or interrupted save can leave two rows flagged — the version number is the
 * one value that is always right.
 */
export function latestVersion(chain: QuotationVersion[]): QuotationVersion | null {
  if (chain.length === 0) return null;
  return chain.reduce((best, row) => (row.version > best.version ? row : best), chain[0]);
}

/**
 * The version that replaced this one, or `null` when this IS the newest.
 *
 * Drives the "Superseded by v3" banner and hides MAKE VERSION on an old
 * version — branching from an old version would fork the chain and collide on
 * the `QT-0034-2` numbering, which assumes one line of versions.
 */
export function supersededBy(
  chain: QuotationVersion[],
  currentId: string,
): QuotationVersion | null {
  const latest = latestVersion(chain);
  if (!latest || latest.id === currentId) return null;
  return latest;
}

/**
 * Every version of a quotation, oldest first, in one round trip.
 *
 * The RPC is SECURITY INVOKER, so the caller's RLS still scopes the chain to
 * their own tenant (migration 20261012160000).
 */
export async function fetchQuotationVersions(
  supabase: SupabaseClient,
  quotationId: string,
): Promise<QuotationVersion[]> {
  const { data, error } = await supabase.rpc("quotation_version_chain", {
    p_quotation_id: quotationId,
  });
  if (error) {
    console.error("Failed to load quotation versions", error.message);
    return [];
  }
  return (data as QuotationVersion[]) ?? [];
}

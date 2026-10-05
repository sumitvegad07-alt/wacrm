import { createClient } from '@/lib/supabase/client';
import type { TerritoryNode } from './types';

/**
 * How many customers sit in each territory, for the badge beside its name in the
 * area pickers.
 *
 * The figure has to be the SUBTREE total, not the customers pinned directly to a
 * node. Checked against live data on 2026-10-05: customers sit at levels 2, 3
 * and 4 and none at level 1, so a direct-only count would read 0 beside India
 * while 293 customers sat underneath it.
 */

/** Customers pinned directly to each territory, keyed by territory id. */
export async function fetchDirectCustomerCounts(accountId: string): Promise<Map<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('territory_customer_counts', {
    p_account_id: accountId,
  });
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { territory_id: string; customer_count: number }[]) {
    counts.set(row.territory_id, Number(row.customer_count) || 0);
  }
  return counts;
}

/**
 * Total customers per territory: its own plus everything beneath it.
 *
 * Counts for ids that are not in the tree are ignored rather than added to some
 * ancestor — an archived territory is filtered out of the tree but its customers
 * still carry its id, and folding those in would make a parent's badge larger
 * than anything the screen could account for.
 */
export function rollUpCustomerCounts(
  nodes: TerritoryNode[],
  direct: Map<string, number>,
): Map<string, number> {
  const totals = new Map<string, number>();

  const walk = (node: TerritoryNode): number => {
    let total = direct.get(node.id) ?? 0;
    for (const child of node.children) total += walk(child);
    totals.set(node.id, total);
    return total;
  };

  nodes.forEach(walk);
  return totals;
}

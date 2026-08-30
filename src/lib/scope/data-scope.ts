/**
 * Directional data-scoping (web app-level, Phase 11 — parity with the mobile Phase 9 layer).
 *
 * Default: a user sees only their OWN records. Two rights widen that, directionally, through the
 * `profiles.manager_id` reporting tree:
 *   - `view_child_data`  → also their SUBORDINATES' records (everyone in their downline)
 *   - `view_parent_data` → also their MANAGERS' records (their upline chain)
 * Owner / admin / superadmin / a role with {all:true} see everything and are never scoped — the
 * caller (useDataScope) checks that and skips scoping entirely.
 *
 * The real security boundary is the RLS layer on prod (migration `directional_data_scope_rls`);
 * this app-level pass is defense-in-depth + nicer empty states, and is applied ONLY to the
 * tables whose RLS is a *pure* directional check (orders/deals/site_visits.user_id,
 * expenses.employee_id). Tables whose RLS OR-s the directional path alongside territory /
 * collaborator visibility (contacts/leads/payments) are intentionally NOT hard-filtered here —
 * a client `.in()` would subtract rows RLS legitimately returns. See useDataScope for that split.
 *
 * Because different tables key ownership on different columns, the resolver returns BOTH sets:
 *   - userIds    (auth user ids)   — orders/deals/site_visits.user_id
 *   - profileIds (profiles.id)     — expenses.employee_id
 */

import { createClient } from "@/lib/supabase/client";

export interface VisibleScope {
  /** Auth user ids the viewer may see (always includes their own). */
  userIds: string[];
  /** profiles.id values the viewer may see (always includes their own). */
  profileIds: string[];
}

interface ProfileRow {
  id: string;
  user_id: string;
  manager_id: string | null;
}

/**
 * Resolve the set of users whose records the viewer may see, walking the manager_id tree
 * client-side (team sizes are small, so one profiles fetch is cheap and avoids the
 * profiles.id-vs-user_id trap). Mirrors wacrm-mobile/src/lib/scope/dataScope.ts.
 */
export async function getVisibleUserScope(
  accountId: string,
  currentUserId: string,
  opts: { viewChild: boolean; viewParent: boolean },
): Promise<VisibleScope> {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, user_id, manager_id")
    .eq("account_id", accountId);

  const profiles = (data ?? []) as ProfileRow[];
  const me = profiles.find((p) => p.user_id === currentUserId) ?? null;

  const userIds = new Set<string>([currentUserId]);
  const profileIds = new Set<string>();
  if (me) profileIds.add(me.id);

  // Nothing to widen (or we can't locate the viewer's profile) → own only.
  if (!me || (!opts.viewChild && !opts.viewParent)) {
    return { userIds: [...userIds], profileIds: [...profileIds] };
  }

  const byId = new Map(profiles.map((p) => [p.id, p]));

  if (opts.viewChild) {
    // Children indexed by their manager, then BFS down from the viewer.
    const childrenOf = new Map<string, ProfileRow[]>();
    profiles.forEach((p) => {
      if (p.manager_id) {
        const list = childrenOf.get(p.manager_id) ?? [];
        list.push(p);
        childrenOf.set(p.manager_id, list);
      }
    });
    const queue: string[] = [me.id];
    const seen = new Set<string>([me.id]);
    while (queue.length) {
      const mgrId = queue.shift()!;
      for (const child of childrenOf.get(mgrId) ?? []) {
        if (seen.has(child.id)) continue; // guard against a malformed cycle
        seen.add(child.id);
        profileIds.add(child.id);
        userIds.add(child.user_id);
        queue.push(child.id);
      }
    }
  }

  if (opts.viewParent) {
    // Walk up the manager chain from the viewer.
    let cur: ProfileRow | undefined = me;
    const seen = new Set<string>([me.id]);
    while (cur?.manager_id && !seen.has(cur.manager_id)) {
      const mgr = byId.get(cur.manager_id);
      if (!mgr) break;
      seen.add(mgr.id);
      profileIds.add(mgr.id);
      userIds.add(mgr.user_id);
      cur = mgr;
    }
  }

  return { userIds: [...userIds], profileIds: [...profileIds] };
}

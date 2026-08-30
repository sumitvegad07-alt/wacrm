"use client";

/**
 * useDataScope — the web app-level directional data-scoping hook (Phase 11, parity with the
 * mobile Phase 9 `useDataScope`).
 *
 * Resolves, once per viewer/account, the set of user/profile ids this role may see (own +
 * downline if `view_child_data` + upline if `view_parent_data`) by walking `profiles.manager_id`.
 *
 * Scoping is a NO-OP (everyone unrestricted, `apply` returns the query untouched) when ANY of:
 *   - the role bypasses (owner / admin / superadmin / a role with {all:true}), OR
 *   - the account has Reporting Hierarchy DISABLED — without a reporting tree there is no
 *     parent/child concept, so visibility stays account-wide (this is what keeps a company that
 *     never turned hierarchy on from suddenly dropping everyone to own-only), OR
 *   - module settings haven't loaded yet (fail *open* to account-wide during the load window;
 *     the RLS layer still scopes the actual rows the DB returns, so nothing leaks).
 *
 * IMPORTANT — only apply this to tables whose RLS is a *pure* directional check
 * (orders/deals/site_visits.user_id, expenses.employee_id). Do NOT apply it to contacts / leads /
 * payments: their RLS OR-s the directional path alongside territory + collaborator visibility, so
 * a client `.in()` there would subtract rows RLS legitimately returns. Those stay RLS-authoritative.
 *
 * Usage in a list fetch:
 *   const scope = useDataScope();
 *   const fetchData = useCallback(async () => {
 *     if (!scope.ready) return;                       // wait for the id set
 *     let q = supabase.from('orders').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
 *     q = scope.apply(q, 'user_id');                  // no-op when unrestricted
 *     const { data } = await q;
 *     ...
 *   }, [accountId, scope.ready, scope.key]);          // re-fetch when the visible set changes
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getVisibleUserScope, type VisibleScope } from "@/lib/scope/data-scope";

export interface DataScope {
  /** Sees everything; `apply` is a no-op (role bypass, hierarchy off, or settings not yet loaded). */
  unrestricted: boolean;
  /** True once the id set is resolved (or immediately when unrestricted). Gate the first fetch on this. */
  ready: boolean;
  userIds: string[];
  profileIds: string[];
  /** Stable string identical whenever the effective filter is — put it in fetch-effect deps. */
  key: string;
  /**
   * Constrain a Supabase query to the visible ids on `column`. `idKind` picks which set —
   * 'user' (auth user ids, the default) or 'profile' (profiles.id, e.g. expenses.employee_id).
   * A no-op when unrestricted. When scoped to an empty set it matches nothing (safe default).
   */
  apply: <T>(query: T, column: string, idKind?: "user" | "profile") => T;
}

export function useDataScope(): DataScope {
  const {
    user,
    accountId,
    isOwner,
    isAdmin,
    isSuperadmin,
    hasPermission,
    isModuleEnabled,
    moduleSettingsLoaded,
  } = useAuth();
  const currentUserId = user?.id ?? null;

  const roleUnrestricted = isOwner || isAdmin || isSuperadmin || hasPermission("all");
  const viewChild = hasPermission("view_child_data");
  const viewParent = hasPermission("view_parent_data");
  const hierarchyOn = isModuleEnabled("reporting_hierarchy");

  // Scoping only activates once module settings are known, the role doesn't bypass, AND the
  // account turned Reporting Hierarchy on. Otherwise everyone is unrestricted.
  const scopingActive = moduleSettingsLoaded && !roleUnrestricted && hierarchyOn;

  const [scope, setScope] = useState<VisibleScope | null>(null);

  useEffect(() => {
    if (!scopingActive || !accountId || !currentUserId) {
      setScope(null);
      return;
    }
    let alive = true;
    getVisibleUserScope(accountId, currentUserId, { viewChild, viewParent })
      .then((s) => {
        if (alive) setScope(s);
      })
      .catch(() => {
        // Fall back to own-only rather than leaking the whole account.
        if (alive) setScope({ userIds: currentUserId ? [currentUserId] : [], profileIds: [] });
      });
    return () => {
      alive = false;
    };
  }, [scopingActive, accountId, currentUserId, viewChild, viewParent]);

  const unrestricted = !scopingActive;
  const ready = unrestricted || scope !== null;

  const userIds = useMemo(
    () => scope?.userIds ?? (currentUserId ? [currentUserId] : []),
    [scope, currentUserId],
  );
  const profileIds = useMemo(() => scope?.profileIds ?? [], [scope]);

  // A stable dependency key: identical whenever the effective filter is identical, so a
  // consumer's fetch effect re-runs exactly when the visible set changes (not on every render).
  const key = useMemo(
    () =>
      unrestricted
        ? "all"
        : `u:${[...userIds].sort().join(",")}|p:${[...profileIds].sort().join(",")}`,
    [unrestricted, userIds, profileIds],
  );

  // `apply` reads the latest ids via a ref so its identity stays stable — consumers trigger
  // re-fetches off `key` / `ready`, never off apply's identity.
  const latest = useRef({ unrestricted, userIds, profileIds });
  latest.current = { unrestricted, userIds, profileIds };

  const apply = useCallback(
    <T,>(query: T, column: string, idKind: "user" | "profile" = "user"): T => {
      const snap = latest.current;
      if (snap.unrestricted) return query;
      const ids = idKind === "profile" ? snap.profileIds : snap.userIds;
      // Empty set → match nothing (a sentinel no real row's id equals), never "match all".
      const safe = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
      return (query as any).in(column, safe) as T;
    },
    [],
  );

  return { unrestricted, ready, userIds, profileIds, key, apply };
}

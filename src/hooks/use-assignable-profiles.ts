"use client";

/**
 * WHO this user may hand an activity to.
 *
 * SOURCE OF TRUTH IS SHARED WITH MOBILE: wacrm-mobile/src/hooks/
 * useAssignableProfiles.ts. The two repos have no common package, so this is a
 * deliberate copy — change one, change the other.
 *
 * The rule, from the founder (2026-11-09): being allowed to assign work is
 * directional, exactly like being allowed to read it.
 *
 *   assign_tasks_all    → anyone in the account
 *   assign_tasks_child  → the people reporting to you, down the tree
 *   assign_tasks_parent → your managers, up the chain
 *   none of them        → only yourself
 *
 * and the two directional rights mean nothing without Reporting Hierarchy
 * switched on: with no manager tree there is no up or down.
 *
 * What it replaces here:
 *
 *   const canAssignOthers = isAdmin || isOwner || hasAnyAssignRight;
 *   const assignableProfiles = canAssignOthers
 *     ? profiles
 *     : profiles.filter(p => p.id === user?.id);
 *
 * — which offered the WHOLE staff roster to anyone holding any one of the
 * three rights, and, in the else branch, compared `profiles.id` against the
 * auth user id. Those are different id spaces (profiles.id is not auth.uid),
 * so that filter always matched nothing and a user without the right got an
 * empty picker rather than their own name.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getVisibleUserScope, listAccountProfiles } from "@/lib/scope/data-scope";
import { decideAssignMode } from "@/lib/tasks/assign-scope";
import type { Profile } from "@/types";

export interface AssignableScope {
  /** True once the list has resolved. */
  ready: boolean;
  /** The people this user may assign to — always includes themselves. */
  profiles: Profile[];
  /**
   * True when there is somebody OTHER than the viewer to choose from. The
   * assignee control is hidden when this is false: a picker whose only option
   * is you is not a choice, and showing it disabled advertises something the
   * role cannot do.
   */
  canAssignOthers: boolean;
  /** This user's own profiles.id, which an unassignable activity falls back to. */
  myProfileId: string | null;
}

export function useAssignableProfiles(): AssignableScope {
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

  const unrestricted = isOwner || isAdmin || isSuperadmin || hasPermission("all");
  const assignAll = hasPermission("assign_tasks_all");
  const assignChild = hasPermission("assign_tasks_child");
  const assignParent = hasPermission("assign_tasks_parent");
  const hierarchyOn = isModuleEnabled("reporting_hierarchy");

  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (!accountId || !currentUserId || !moduleSettingsLoaded) return;
    let alive = true;

    void (async () => {
      setReady(false);

      const all = await listAccountProfiles<Profile>();
      if (!alive) return;

      const me = all.find((p) => (p as { user_id?: string }).user_id === currentUserId) ?? null;
      setMyProfileId(me?.id ?? null);

      const mode = decideAssignMode({
        unrestricted,
        assignAll,
        assignChild,
        assignParent,
        hierarchyOn,
      });

      if (mode === "all") {
        setProfiles(all);
        setReady(true);
        return;
      }

      if (mode === "self") {
        setProfiles(me ? [me] : []);
        setReady(true);
        return;
      }

      const scope = await getVisibleUserScope(accountId, currentUserId, {
        viewChild: assignChild,
        viewParent: assignParent,
      });
      if (!alive) return;
      const allowed = new Set(scope.profileIds);
      if (me) allowed.add(me.id);
      setProfiles(all.filter((p) => allowed.has(p.id)));
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [
    accountId,
    currentUserId,
    moduleSettingsLoaded,
    unrestricted,
    assignAll,
    assignChild,
    assignParent,
    hierarchyOn,
  ]);

  return {
    ready,
    profiles,
    canAssignOthers: profiles.some((p) => p.id !== myProfileId),
    myProfileId,
  };
}

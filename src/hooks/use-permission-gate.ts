"use client";

import { useAuth } from "@/hooks/use-auth";
import {
  permissionGateState,
  type PermissionGateState,
} from "@/lib/auth/permission-gate";

/**
 * Full-page permission gate.
 *
 * ```tsx
 * const gate = usePermissionGate(hasPermission("view_team_management") || isSuperadmin);
 * if (gate === "loading") return <PageLoader text="Checking your access…" />;
 * if (gate === "denied") return <YourOwnRefusalUI />;
 * ```
 *
 * Pass the page's own verdict; this adds the state that verdict cannot
 * express — "the profile has not loaded, so nobody's permissions are
 * known yet". Without it a page refuses its own owner for the first
 * ~700ms of every cold load. See `@/lib/auth/permission-gate`.
 *
 * Each page keeps its own refusal UI; this only decides which branch to
 * take, so adopting it never changes how a real denial looks.
 */
export function usePermissionGate(allowed: boolean): PermissionGateState {
  const { profileLoading } = useAuth();
  return permissionGateState({ profileLoading, allowed });
}

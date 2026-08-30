"use client";

import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

/**
 * Client-side page guard. Renders `children` only when the signed-in user holds (any of) the
 * required permission key(s), otherwise an Access Denied panel — mirroring the inline guards on
 * the Roles and Import pages. Use it to protect standalone pages that are reachable by a typed URL
 * even when their sidebar link is hidden (the sidebar only controls the LINK, not the route).
 *
 * Owner/admin roles carry `{all: true}` and pass `hasPermission`; superadmin passes explicitly —
 * the same rule the existing guards use, so this never locks an admin out.
 */
export function RequirePermission({
  permission,
  children,
}: {
  /** A single permission key, or several — any one grants access. */
  permission: string | string[];
  children: React.ReactNode;
}) {
  const { hasPermission, isSuperadmin } = useAuth();
  const keys = Array.isArray(permission) ? permission : [permission];
  const allowed = isSuperadmin || keys.some((k) => hasPermission(k));

  if (!allowed) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You do not have permission to view this page. Ask an admin to grant it in Team →
            Employee Roles.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}

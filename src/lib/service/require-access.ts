// Server-side gate for the FSM asset screens. Used by service/layout.tsx and by each page.
//
// WHY BOTH, not just the layout: Next.js layouts do not re-render on client-side navigation
// (node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Layouts and auth checks"), so a
// layout-only guard runs once when someone enters /service and never again for the next click. The
// layout is the first line (a real redirect before anything renders); every page repeats the check
// close to its data. `cache()` makes the two calls share one result per request, so the repeat
// costs nothing.
//
// The decision itself is serviceAssetRights (access.ts), a pure function with its own tests.
// This file only gathers its inputs: the plan, the account role and the employee-role permissions.
// Success carries the viewer's rights (view is always true there; create/edit/delete decide which
// buttons and forms a screen shows), so no page needs to ask the browser what the server can say.

import { cache } from 'react';
import {
  getCurrentAccount,
  ForbiddenError,
  UnauthorizedError,
  type AccountContext,
} from '@/lib/auth/account';
import type { RolePermissions } from '@/lib/auth/rbac';
import { serviceAssetRights, type ServiceAssetRights } from './access';

export type ServiceAccess =
  | { ok: true; ctx: AccountContext; rights: ServiceAssetRights }
  | { ok: false; redirectTo: '/login' | '/dashboard' };

/**
 * Resolve the caller and decide. Never throws for "not allowed": it returns where to send them, so
 * the caller can `redirect()` OUTSIDE any try/catch (redirect works by throwing).
 *
 * Unexpected failures (a database error loading the plan, say) are rethrown so Next's error
 * boundary shows them, rather than silently bouncing a legitimate user to the dashboard.
 */
export const resolveServiceAssetsAccess = cache(async (): Promise<ServiceAccess> => {
  let ctx: AccountContext;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, redirectTo: '/login' };
    if (err instanceof ForbiddenError) return { ok: false, redirectTo: '/dashboard' };
    throw err;
  }

  const [accountRes, profileRes] = await Promise.all([
    ctx.supabase.from('accounts').select('subscription_plan').eq('id', ctx.accountId).maybeSingle(),
    ctx.supabase.from('profiles').select('employee_roles(permissions)').eq('user_id', ctx.userId).maybeSingle(),
  ]);
  if (accountRes.error) throw new Error(`Could not load the account plan: ${accountRes.error.message}`);
  if (profileRes.error) throw new Error(`Could not load the user's role: ${profileRes.error.message}`);

  // profiles.employee_role_id is many-to-one, so the embed is an object; tolerate an array in case
  // PostgREST ever infers it the other way round.
  const embedded = (profileRes.data as { employee_roles?: unknown } | null)?.employee_roles;
  const roleRow = Array.isArray(embedded) ? embedded[0] : embedded;
  const permissions = ((roleRow as { permissions?: unknown } | null | undefined)?.permissions ?? null) as RolePermissions | null;

  const rights = serviceAssetRights({
    plan: accountRes.data?.subscription_plan,
    accountRole: ctx.role,
    permissions,
  });
  return rights.view ? { ok: true, ctx, rights } : { ok: false, redirectTo: '/dashboard' };
});

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveServiceAssetsAccess } from "@/lib/service/require-access";

export const metadata: Metadata = {
  title: "Service",
};

/**
 * Server-side gate for everything under /service.
 *
 * Every other plan-gated route in this app is gated on the client only (dashboard-shell.tsx plus
 * hiding the nav item, with RLS behind both). The spec asks for more here: without the `fsm` plan
 * line and `view_service_assets`, the route is not rendered at all (spec 7.1, "Permission denied").
 * This layout redirects before any child renders, so the page's HTML and data never reach the
 * browser. The client guard in dashboard-shell.tsx stays, to avoid a visible flash and to match
 * every other gated module.
 *
 * Layouts do not re-render on client-side navigation, so this runs on entry only; each page calls
 * resolveServiceAssetsAccess() again (cheap, `cache()`d per request) so a page is protected even
 * when reached by an in-app link.
 *
 * Plan line and permission ONLY. `isModuleEnabled('service')` is deliberately not checked:
 * ModuleSettings has no `service` key until the settings task adds one.
 *
 * The right checked is view_service_assets, which is correct while Assets is the only screen. When
 * Jobs arrive they need their own right, so widen this to "any service view right" (or move the
 * check into each page) at that point.
 */
export default async function ServiceLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveServiceAssetsAccess();
  if (!access.ok) redirect(access.redirectTo);
  return <>{children}</>;
}

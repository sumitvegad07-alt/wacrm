"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { gatePasses, gateForPath } from "@/lib/plans/surface-gates";
import type { ProductLine } from "@/lib/plans/catalog";

// The reports live at /reports/<type> (sales, orders, payments, ...); there is no
// bare index, so a typed or bookmarked /reports forwards to a real report instead
// of 404-ing.
//
// It used to forward unconditionally to /reports/sales, which is SFA — on a
// CRM-only or WFA-only plan the route guard then bounced the user straight on to
// /dashboard, so /reports looked broken. Pick the first report the plan actually
// includes instead.
const CANDIDATES = [
  "/reports/sales",
  "/reports/orders",
  "/reports/leads",
  "/reports/deals",
  "/reports/visits",
  "/reports/dsr",
  "/reports/tasks", // base on every plan — the guaranteed fallback
] as const;

export default function ReportsIndexPage() {
  const router = useRouter();
  const { hasCRM, hasWFA, hasSFA, hasFSM, isModuleEnabled, moduleSettingsLoaded } = useAuth();

  useEffect(() => {
    if (!moduleSettingsLoaded) return;
    const owns: Record<ProductLine, boolean> = { crm: hasCRM, wfa: hasWFA, sfa: hasSFA, fsm: hasFSM };
    const target =
      CANDIDATES.find((href) => gatePasses(gateForPath(href), { owns, isModuleEnabled })) ??
      "/reports/tasks";
    router.replace(target);
  }, [moduleSettingsLoaded, hasCRM, hasWFA, hasSFA, hasFSM, isModuleEnabled, router]);

  return (
    <div className="p-8 text-center text-sm text-muted-foreground">Opening reports…</div>
  );
}

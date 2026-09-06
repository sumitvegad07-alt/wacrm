"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDataScope } from "@/hooks/use-data-scope";
import { formatCurrency } from "@/lib/currency";
import { ShoppingCart, TrendingUp, Truck, DollarSign } from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { SectionHeading } from "./section-heading";
import { loadSalesMetrics, type SalesMetrics } from "@/lib/dashboard/sales-queries";
import { SfaAnalytics } from "./sfa-analytics";
import {
  TodaysCollectionWidget,
  MonthlyCollectionWidget,
  OutstandingAmountWidget,
  CollectionByTypeWidget,
  CollectionByUserWidget,
  PendingApprovalAgingWidget,
  OverdueCustomersWidget,
  CreditExceededWidget,
} from "@/components/dashboard/payment-widgets";

/**
 * Sales (SFA line) section — orders booked, month-to-date value, dispatch
 * backlog, and (when the Payment module is on) the full collections &
 * receivables board reused from the existing self-fetching payment widgets.
 * Rendered only when the plan includes the SFA line. Order numbers respect the
 * viewer's data scope; the payment widgets are account-level by design.
 */
export function SalesSection() {
  const { accountId, defaultCurrency, isModuleEnabled } = useAuth();
  const scope = useDataScope();
  const paymentOn = isModuleEnabled("payment");
  const dispatchOn = isModuleEnabled("dispatch");

  const [metrics, setMetrics] = useState<SalesMetrics | null>(null);

  useEffect(() => {
    if (!accountId || !scope.ready) return;
    let alive = true;
    const db = createClient();
    void loadSalesMetrics(db, accountId, scope)
      .then((m) => {
        if (alive) setMetrics(m);
      })
      .catch((err) => console.error("[dashboard/sales] metrics failed:", err));
    return () => {
      alive = false;
    };
  }, [accountId, scope.ready, scope.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = metrics === null;

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Sales"
        subtitle="Orders, dispatch, and money coming in."
        icon={ShoppingCart}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: dispatchOn ? 4 : 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Link href="/orders">
              <MetricCard
                title="Orders Today"
                value={metrics.ordersTodayCount.toLocaleString()}
                icon={ShoppingCart}
                subtitle={`${formatCurrency(metrics.ordersTodayValue, defaultCurrency)} booked today`}
              />
            </Link>
            <MetricCard
              title="Sales This Month"
              value={formatCurrency(metrics.ordersMonthValue, defaultCurrency)}
              icon={TrendingUp}
              subtitle="Order value, month to date"
            />
            {dispatchOn && (
              <Link href="/pending-dispatch">
                <MetricCard
                  title="Pending Dispatch"
                  value={metrics.pendingDispatchCount.toLocaleString()}
                  icon={Truck}
                  subtitle={metrics.pendingDispatchCount > 0 ? "Awaiting shipment" : "Nothing waiting"}
                  className={metrics.pendingDispatchCount > 0 ? "border-amber-500/20" : ""}
                />
              </Link>
            )}
            {paymentOn && (
              <Link href="/payments">
                <div className="h-full">
                  <TodaysCollectionWidget />
                </div>
              </Link>
            )}
          </>
        )}
      </div>

      {paymentOn && (
        <div className="space-y-4">
          <div className="mb-1 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Collections &amp; Receivables</h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MonthlyCollectionWidget />
            <OutstandingAmountWidget />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CollectionByTypeWidget />
            <CollectionByUserWidget />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <PendingApprovalAgingWidget />
            <OverdueCustomersWidget />
            <CreditExceededWidget />
          </div>
        </div>
      )}

      {/* Deep analytics — trends, KPIs, and top-5 leaderboards with a
          Daily/Monthly/Quarterly/Yearly lens. Respects the viewer's data
          scope automatically (execute_report runs under RLS). */}
      <SfaAnalytics />
    </section>
  );
}

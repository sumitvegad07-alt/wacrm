import { PageLoader } from "@/components/shared";

/**
 * The loading boundary for every authed route that does not ship its own.
 *
 * Why it sits at the group root rather than on each page: without a boundary a
 * client-side navigation is *blocking*. React keeps the page you are leaving on
 * screen, unchanged, until the next route's payload and JS chunk have both
 * arrived — so clicking Customers, Leads, Quotations, Employees, Deals, Orders,
 * Payments, Expenses or any Report did nothing visible for as long as that took,
 * which is why those buttons read as dead and got clicked again and again.
 * Only the `[id]` detail routes had a boundary, which is why opening a row
 * already felt immediate while opening the list it came from did not.
 *
 * It also makes the sidebar genuinely faster, not just more honest: Next only
 * prefetches a dynamic route as far as its nearest loading boundary, so until
 * this file existed there was nothing for those links to prefetch at all.
 *
 * A route that wants a shape-matched skeleton still wins — its own loading.tsx
 * is nearer and takes precedence over this one.
 */
export default function DashboardLoading() {
  return <PageLoader text="Loading…" minHeight="min-h-[60vh]" />;
}

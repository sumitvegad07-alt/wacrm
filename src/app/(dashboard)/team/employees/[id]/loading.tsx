import { PageLoader } from "@/components/shared";

/**
 * Without a loading boundary a navigation to this route is blocking: React
 * holds the whole old page on screen until the RSC payload for this one has
 * arrived, with nothing to show that a click was registered. On the Employees
 * list that gap measured ~900ms on a warm localhost production build, and it
 * is what made a row click read as dead — people clicked again, and the second
 * click, now served from the router cache, opened the page instantly.
 *
 * This file is also what makes prefetching the route worth anything: Next only
 * prefetches a dynamic route as far as its nearest loading boundary, so
 * without one there was nothing for the table's hover prefetch to cache.
 */
export default function EmployeeDetailLoading() {
  return <PageLoader text="Loading employee…" minHeight="min-h-[60vh]" />;
}

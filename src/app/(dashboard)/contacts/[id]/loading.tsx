import { PageLoader } from "@/components/shared";

/**
 * A loading boundary, which is what makes opening this page from a list feel
 * immediate. Without one the navigation is blocking: React holds the whole
 * list on screen until this route's payload has arrived, showing nothing at
 * all in between — measured at ~900ms on a warm localhost production build,
 * and far longer against a real database. That silence is what made a row
 * click look dead and had people clicking twice.
 *
 * It is also what gives the table's hover prefetch something to cache: Next
 * only prefetches a dynamic route as far as its nearest loading boundary.
 */
export default function Loading() {
  return <PageLoader text="Loading customer…" minHeight="min-h-[60vh]" />;
}

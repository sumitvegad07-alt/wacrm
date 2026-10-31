import { PageLoader } from "@/components/shared";

/**
 * One loading boundary for the whole admin area.
 *
 * Without it every navigation inside /admin is blocking: React holds the page
 * you are leaving on screen until the next route's payload has arrived and
 * shows nothing at all in between, so a click looks dead and gets clicked
 * again — or opened in a new tab, which is the only thing that visibly
 * responds. The tenant app was fixed this way in ab67b9a; the superadmin area
 * never had a boundary at all.
 *
 * It sits under admin/layout.tsx, so the sidebar and header stay put and only
 * the page area swaps. It is also what gives Next something to prefetch to:
 * a dynamic route is only prefetched as far as its nearest loading boundary.
 */
export default function Loading() {
  return <PageLoader text="Loading…" minHeight="min-h-[60vh]" />;
}

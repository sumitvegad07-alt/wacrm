import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ReportPageLayoutProps {
  className?: string;
  children: ReactNode;
}

/**
 * Pattern 5 — the report page.
 *
 * Eleven of the fifteen report routes were the identical literal
 * `flex flex-col h-full space-y-4 p-8` wrapping a `<ReportViewer>`. Being
 * identical, they were at least consistent with each other — but not with the
 * rest of the app:
 *
 * - `p-8` sat ON TOP of the page gutter the workspace `<main>` already
 *   applies, so every report had a ~48px margin where every other page has
 *   16px. The gutter belongs to the shell and nowhere else.
 * - `h-full` is not how this app fills the viewport. `PageLayout`/`DataTable`
 *   use the `fill` mechanism, which claims the leftover height with
 *   `lg:flex-1 lg:min-h-0` and keeps a 280px floor so a short viewport
 *   scrolls instead of crushing the table. `h-full` has neither, so a report
 *   table could not take part in it.
 *
 * Reports keep a looser vertical rhythm than a data page (`space-y-4` against
 * `PageLayout`'s `space-y-2`) because a KPI row, a filter bar and a pivot
 * table need separating — that part was right and is kept.
 */
export function ReportPageLayout({ className, children }: ReportPageLayoutProps) {
  return (
    <div
      data-slot="report-page"
      className={cn(
        "w-full space-y-4",
        "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

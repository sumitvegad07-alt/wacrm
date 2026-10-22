"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageLayoutProps extends React.ComponentProps<"div"> {
  /**
   * Optional custom spacing between page sections. Defaults to space-y-2 (8px).
   */
  spacing?: "default" | "tight" | "loose" | "none";
  /**
   * Desktop only: take every pixel of workspace height the header and the
   * page's own toolbars leave over, instead of growing with the content.
   *
   * Set it on a page whose main content is one data grid. The grid (the
   * `fill` prop on DataTable) then scrolls inside the page, which is what
   * keeps the pagination bar on screen however many rows are loaded. Pages
   * that stack cards, charts or forms leave it off and scroll normally.
   */
  fill?: boolean;
}

/**
 * Enterprise PageLayout container.
 *
 * Vertical rhythm only. The page gutter belongs to the workspace `<main>` in
 * dashboard-shell, which already applies it — this used to add px-4/sm:px-6 of
 * its own on top, indenting every data page twice. There is no max-width
 * either: a data grid should use the whole screen it is given.
 */
export function PageLayout({
  className,
  spacing = "default",
  fill = false,
  children,
  ...props
}: PageLayoutProps) {
  const spacingMap = {
    default: "space-y-2",
    tight: "space-y-1.5",
    loose: "space-y-4",
    none: "",
  };

  return (
    <div
      data-slot="page-layout"
      data-fill={fill ? "" : undefined}
      className={cn(
        "w-full",
        // `flex-1` beats the shrink-0 the workspace gives its children, so the
        // page claims the leftover height; `min-h-0` lets its grid shrink
        // inside it instead of overflowing the viewport.
        fill && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden",
        spacingMap[spacing],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

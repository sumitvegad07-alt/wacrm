"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  /**
   * Main page title (renders as an h1 at 24px/700).
   */
  title: string | React.ReactNode;
  /**
   * Subtitle / description below the main title.
   */
  subtitle?: string | React.ReactNode;
  /**
   * Optional badge or status indicator displayed inline next to the title.
   */
  badge?: React.ReactNode;
  /**
   * Optional breadcrumbs navigation above the title.
   */
  breadcrumbs?: React.ReactNode;
  /**
   * Right-aligned actions (e.g. "+ Add New" button, Export button).
   */
  actions?: React.ReactNode;
}

/**
 * Enterprise PageHeader component.
 * Provides a standardized title bar with responsive stacking on mobile screens,
 * consistent typography tokens, and action button container.
 */
export function PageHeader({
  title,
  subtitle,
  badge,
  breadcrumbs,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  if (!breadcrumbs && !badge && !actions) {
    return null;
  }

  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex items-center justify-between gap-3 py-1",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 min-w-0">
        {breadcrumbs && (
          <div className="text-xs text-muted-foreground">
            {breadcrumbs}
          </div>
        )}
        {badge}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

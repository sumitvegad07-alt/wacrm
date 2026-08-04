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
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1 min-w-0">
        {breadcrumbs && (
          <div className="text-xs text-muted-foreground mb-0.5">
            {breadcrumbs}
          </div>
        )}
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
          {actions}
        </div>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { shouldRenderHeader, useTableToolbarSlot } from "@/components/layout/table-toolbar-slot";

export interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  /**
   * @deprecated NOT RENDERED. Accepted so the ~31 screens that pass it keep
   * compiling.
   *
   * The page title moved to the app topbar when the toolbar line was removed,
   * and it is resolved there from a hand-maintained route map in
   * `components/layout/header.tsx`. This prop has rendered nothing since; its
   * doc comment still claimed "renders as an h1 at 24px/700", which is how it
   * went unnoticed.
   *
   * Known consequence of the route map, left as an open decision: it matches by
   * path prefix, so `/contacts/new` resolves to the `/contacts` entry and the
   * Add Customer screen is titled "Customers". Either this prop comes back and
   * the map is retired, or the prop and its call sites are removed and the map
   * gains entries for the `/new` and `/[id]` routes. Do not add a third way.
   */
  title?: string | React.ReactNode;
  /**
   * @deprecated NOT RENDERED. See `title`.
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
  const slot = useTableToolbarSlot();

  // A header with nothing of its own still renders once a table has claimed
  // the slot — otherwise the table's controls would have nowhere to portal to
  // and would disappear without a trace.
  if (
    !shouldRenderHeader({
      breadcrumbs: Boolean(breadcrumbs),
      badge: Boolean(badge),
      actions: Boolean(actions),
      claimed: slot.claimed,
    })
  ) {
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
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {/* The table's own controls land here. The ref callback is what tells
            the table its target exists; leaving the div mounted unconditionally
            keeps that target stable across the page's own re-renders. */}
        <div ref={slot.setNode} className="flex items-center gap-2" />
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.ComponentProps<"div"> {
  /**
   * Icon component or element to display inside the decorative bubble.
   * Can be a Lucide React icon component or custom JSX.
   */
  icon?: React.ReactNode;
  /**
   * Bold heading describing the empty state (e.g. "No contacts found").
   */
  title: string;
  /**
   * Descriptive helper text explaining why it's empty or how to get started.
   */
  description?: string;
  /**
   * Primary CTA button (e.g. <Button>+ Add Contact</Button>).
   */
  action?: React.ReactNode;
  /**
   * Optional secondary action or link below the primary action.
   */
  secondaryAction?: React.ReactNode;
}

/**
 * Enterprise EmptyState component.
 * Standardizes empty state presentation across data tables, card lists,
 * search results, and module landing views.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center p-8 sm:p-12 rounded-xl border border-dashed border-border bg-card/50",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="flex items-center justify-center size-12 rounded-2xl bg-primary/10 text-primary mb-4 shrink-0 shadow-sm">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-base font-semibold text-foreground max-w-sm">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

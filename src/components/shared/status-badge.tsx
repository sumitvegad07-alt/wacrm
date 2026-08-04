"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { STATUS_MAPPINGS, type StatusVariant } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

export interface StatusBadgeProps extends React.ComponentProps<typeof Badge> {
  /**
   * The status string (e.g. "active", "pending", "rejected", "in_progress", "draft").
   * Automatically mapped to a semantic status color if a custom variant is not specified.
   */
  status: string;
  /**
   * Optional custom label to override default title-case formatting of the status string.
   */
  label?: React.ReactNode;
  /**
   * Display style:
   * - "pill" (default): solid/tinted background pill badge
   * - "dot": badge with a colored dot before the text
   * - "outline": outline style badge
   */
  styleType?: "pill" | "dot" | "outline";
  /**
   * Optional icon to display before the label.
   */
  icon?: React.ReactNode;
}

/**
 * Enterprise StatusBadge component.
 * Single source of truth for status indicators across WACRM/OZZO CRM.
 * Translates raw status codes into invariant semantic status badges.
 */
export function StatusBadge({
  status,
  label,
  styleType = "pill",
  icon,
  className,
  variant: overrideVariant,
  ...props
}: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().trim();
  const mappedVariant: StatusVariant =
    (overrideVariant as StatusVariant) ||
    STATUS_MAPPINGS[normalizedStatus] ||
    "neutral";

  // Format label: "in_progress" -> "In Progress"
  const defaultLabel = React.useMemo(() => {
    return status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }, [status]);

  const displayLabel = label || defaultLabel;

  if (styleType === "dot") {
    const dotColorMap: Record<string, string> = {
      success: "bg-success",
      warning: "bg-warning",
      destructive: "bg-destructive",
      info: "bg-info",
      neutral: "bg-muted-foreground",
      default: "bg-primary",
      secondary: "bg-secondary-foreground",
      outline: "bg-foreground",
    };

    return (
      <Badge
        variant="outline"
        className={cn("gap-1.5 font-normal", className)}
        {...props}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            dotColorMap[mappedVariant] || "bg-muted-foreground"
          )}
        />
        {icon}
        <span>{displayLabel}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant={mappedVariant as any}
      className={cn("gap-1", className)}
      {...props}
    >
      {icon}
      <span>{displayLabel}</span>
    </Badge>
  );
}

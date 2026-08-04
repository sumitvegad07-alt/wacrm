"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BulkActionItem {
  /**
   * Action button label (e.g. "Delete", "Export", "Change Status").
   */
  label: string;
  /**
   * Optional icon component displayed before the label.
   */
  icon?: React.ReactNode;
  /**
   * Action click handler.
   */
  onClick: () => void;
  /**
   * Visual button variant. Defaults to "outline".
   */
  variant?: "default" | "destructive" | "outline" | "secondary";
  /**
   * Optional permission string required to render this bulk action.
   */
  permission?: string;
  /**
   * Whether the button is currently disabled.
   */
  disabled?: boolean;
}

export interface BulkActionBarProps extends React.ComponentProps<"div"> {
  /**
   * Number of currently selected items in the table.
   */
  selectedCount: number;
  /**
   * Array of batch actions available for the selected records.
   */
  actions: BulkActionItem[];
  /**
   * Handler to deselect all records.
   */
  onClear: () => void;
  /**
   * Optional custom JSX rendered after the action buttons (e.g. dropdown menus).
   */
  extraActions?: React.ReactNode;
}

/**
 * Enterprise BulkActionBar component.
 * Renders a consistent floating or docked multi-select toolbar whenever
 * one or more table rows are selected.
 */
export function BulkActionBar({
  selectedCount,
  actions,
  onClear,
  extraActions,
  className,
  ...props
}: BulkActionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      data-slot="bulk-action-bar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 text-xs shadow-sm animate-in fade-in-0 duration-150",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center h-6 px-2 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          {selectedCount} selected
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5 mr-1" />
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {actions.map((action, index) => (
          <Button
            key={index}
            type="button"
            variant={action.variant || "outline"}
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className="h-7 text-xs"
          >
            {action.icon && <span className="mr-1.5">{action.icon}</span>}
            {action.label}
          </Button>
        ))}
        {extraActions}
      </div>
    </div>
  );
}

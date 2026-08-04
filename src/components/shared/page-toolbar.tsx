"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageToolbarProps extends React.ComponentProps<"div"> {
  /**
   * Search input configuration.
   */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /**
   * Additional filter dropdowns or date pickers rendered after the search bar.
   */
  filters?: React.ReactNode;
  /**
   * Optional right-hand actions (e.g. view toggle, column picker).
   */
  actions?: React.ReactNode;
  /**
   * CSV export callback. When provided, renders a standard Export button.
   */
  onExportCsv?: () => void;
  /**
   * Refresh callback. When provided, renders a standard Refresh icon button.
   */
  onRefresh?: () => void;
  /**
   * Whether refresh is currently in progress.
   */
  refreshing?: boolean;
}

/**
 * Enterprise PageToolbar component.
 * Enforces invariant toolbar order across every CRUD page:
 * Search -> Filters -> Right Actions -> Export -> Refresh.
 * Always renders inside a unified card panel border.
 */
export function PageToolbar({
  search,
  filters,
  actions,
  onExportCsv,
  onRefresh,
  refreshing = false,
  className,
  ...props
}: PageToolbarProps) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card",
        className
      )}
      {...props}
    >
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 min-w-0">
        {search && (
          <div className="relative w-full sm:w-72 shrink-0">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder || "Search..."}
              className="pl-9 h-9 w-full"
            />
          </div>
        )}
        {filters && (
          <div className="flex items-center gap-2 flex-wrap">
            {filters}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        {actions}
        {onExportCsv && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            className="h-9 gap-1.5"
          >
            <DownloadIcon className="size-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        )}
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-9 w-9 shrink-0"
            title="Refresh data"
          >
            <RefreshCwIcon
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
          </Button>
        )}
      </div>
    </div>
  );
}

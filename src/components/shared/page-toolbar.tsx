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
  // `search` counts. Leaving it out of this test meant a screen whose only
  // toolbar content was a search box rendered no toolbar at all — which is how
  // ten screens (Orders, Payments, Quotations, Tasks, Dispatches, Pending
  // Dispatch, Visits, Employees, Announcements, Routes) all shipped with a
  // search box that was passed in and silently dropped.
  if (!search && !filters && !actions && !onExportCsv && !onRefresh) {
    return null;
  }

  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 py-2 px-3 rounded-t-lg border border-b-0 border-border bg-muted/30 text-xs min-h-[44px]",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {search && (
          <div className="relative w-full sm:w-72">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search..."}
              aria-label={search.placeholder ?? "Search"}
              className="pl-8"
            />
          </div>
        )}
        {filters}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onExportCsv && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            className="h-11 md:h-8 gap-1.5 text-xs"
          >
            <DownloadIcon className="size-3" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        )}
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="h-11 w-11 md:h-8 md:w-8 p-0 shrink-0"
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

"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableSkeletonProps extends React.ComponentProps<"div"> {
  /**
   * Number of columns to render in the skeleton grid.
   */
  columns?: number;
  /**
   * Number of skeleton rows to render. Defaults to 5.
   */
  rows?: number;
}

/**
 * Enterprise TableSkeleton component.
 * Replaces plain text "Loading..." in tables with an animated skeleton structure
 * that preserves the table's visual height and layout during data fetches.
 */
export function TableSkeleton({
  columns = 5,
  rows = 5,
  className,
  ...props
}: TableSkeletonProps) {
  return (
    <div
      data-slot="table-skeleton"
      className={cn("w-full space-y-2.5 p-4", className)}
      {...props}
    >
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center justify-between gap-4 py-2"
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div
              key={colIndex}
              className={cn(
                "h-5 rounded-md bg-muted/60 animate-pulse",
                colIndex === 0 ? "w-1/4" : colIndex === columns - 1 ? "w-16" : "w-1/6"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface PageLoaderProps extends React.ComponentProps<"div"> {
  /**
   * Optional loading text displayed below the spinner.
   */
  text?: string;
  /**
   * Minimum height of the loader container. Defaults to "min-h-[200px]".
   */
  minHeight?: string;
}

/**
 * Enterprise PageLoader component.
 * Standardizes full-page and section loading spinners across all modules.
 */
export function PageLoader({
  text = "Loading data...",
  minHeight = "min-h-[200px]",
  className,
  ...props
}: PageLoaderProps) {
  return (
    <div
      data-slot="page-loader"
      className={cn(
        "flex flex-col items-center justify-center gap-3 w-full p-8 text-center text-muted-foreground",
        minHeight,
        className
      )}
      {...props}
    >
      <Loader2Icon className="size-6 animate-spin text-primary" />
      {text && <p className="text-sm font-medium">{text}</p>}
    </div>
  );
}

export interface InlineLoaderProps extends React.ComponentProps<"span"> {
  text?: string;
}

/**
 * Small inline spinner for status indicators and inline buttons.
 */
export function InlineLoader({
  text,
  className,
  ...props
}: InlineLoaderProps) {
  return (
    <span
      data-slot="inline-loader"
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      {...props}
    >
      <Loader2Icon className="size-3.5 animate-spin" />
      {text && <span>{text}</span>}
    </span>
  );
}

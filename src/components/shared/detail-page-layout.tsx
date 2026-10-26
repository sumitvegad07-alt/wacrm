"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pattern 4 — the record detail / output page.
 *
 * This pattern had no implementation at all. Not one of the twelve
 * record-detail pages (`contacts/[id]`, `leads/[id]`, `deals/[id]`,
 * `quotations/[id]`, `orders/[id]`, `products/[id]`, `payments/[id]`,
 * `expenses/[id]`, `dispatches/[id]`, `stock/[id]`, `team/employees/[id]`,
 * `service/assets/[id]`) used `PageLayout` or `PageHeader`; each hand-rolled
 * its own container, its own `<h1>` and its own section cards. They disagreed
 * on the container (`space-y-6 w-full max-w-none flex flex-col h-full` on
 * three of them, `space-y-6 w-full max-w-none` on three more, bare `space-y-6`
 * on one, and `mx-auto w-full max-w-7xl` on `leads/[id]` — the only centred,
 * width-capped page anywhere in the app), on the back control, on the title
 * size, and on whether a status was a `StatusBadge` or an inline colour.
 *
 * Compose a detail page from `DetailPageLayout` > `DetailSection` >
 * `DetailGrid` > `DetailItem`. Line items and other tabular content go in a
 * table, not in a grid of pairs.
 */

export interface DetailPageLayoutProps {
  /** The record's own name — the customer, the order number. Not the module. */
  title: React.ReactNode;
  /**
   * The meta line under the title: phone, email, owner, dates. Keep it to
   * identifying detail; anything a user acts on belongs in `actions`.
   */
  meta?: React.ReactNode;
  /** Status badge and tags, rendered inline after the title. */
  badges?: React.ReactNode;
  /** Right-aligned actions — Edit, Print, workflow buttons. */
  actions?: React.ReactNode;
  /**
   * Back handler. Omit it and no back control is rendered (for a page reached
   * only as a tab, where back would leave the record).
   */
  onBack?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function DetailPageLayout({
  title,
  meta,
  badges,
  actions,
  onBack,
  className,
  children,
}: DetailPageLayoutProps) {
  return (
    // No padding and no max-width: the page gutter belongs to the workspace
    // <main> in dashboard-shell and is already applied. Adding any here is
    // what double-indented every data page before PageLayout's own padding
    // was removed — and is still what FormPageShell does.
    <div data-slot="detail-page" className={cn("w-full space-y-4", className)}>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label="Go back"
              data-shortcut="back"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-page-title font-bold text-foreground">
              <span className="truncate">{title}</span>
              {badges}
            </h1>
            {meta && (
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                {meta}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

export interface DetailSectionProps {
  title?: React.ReactNode;
  /** Right-aligned content in the section heading row. */
  action?: React.ReactNode;
  /** Drop the card chrome — for a section that already renders its own card. */
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** One card-framed block of a detail page. */
export function DetailSection({
  title,
  action,
  bare,
  className,
  children,
}: DetailSectionProps) {
  return (
    <section
      data-slot="detail-section"
      className={cn(
        !bare && "rounded-lg border border-border bg-card p-4 sm:p-5",
        className
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-end justify-between gap-3">
          {title && (
            <h2 className="text-section font-semibold text-foreground">{title}</h2>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const DETAIL_GRID_COLS = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
} as const;

export interface DetailGridProps {
  /** Columns at the widest breakpoint. Defaults to 2. */
  cols?: keyof typeof DETAIL_GRID_COLS;
  className?: string;
  children: React.ReactNode;
}

/** The grid of label/value pairs inside a `DetailSection`. */
export function DetailGrid({ cols = 2, className, children }: DetailGridProps) {
  return (
    <div
      data-slot="detail-grid"
      className={cn("grid gap-x-4 gap-y-4", DETAIL_GRID_COLS[cols], className)}
    >
      {children}
    </div>
  );
}

export interface DetailItemProps {
  label: React.ReactNode;
  /**
   * The value. An empty string, null or undefined renders the shared em-dash
   * placeholder, so a blank field never reads as a broken one — and so the
   * app stops mixing `'-'`, `'—'` and an empty cell for the same thing.
   */
  value?: React.ReactNode;
  /** Columns to span. `full` for addresses, notes, terms. */
  span?: 1 | 2 | "full";
  className?: string;
  /** Overrides `value` when the value needs its own markup (a link, a badge). */
  children?: React.ReactNode;
}

const DETAIL_ITEM_SPANS = {
  1: "",
  2: "sm:col-span-2",
  full: "col-span-full",
} as const;

export function DetailItem({
  label,
  value,
  span = 1,
  className,
  children,
}: DetailItemProps) {
  const isEmpty =
    children === undefined &&
    (value === undefined || value === null || value === "");

  return (
    <div
      data-slot="detail-item"
      className={cn("min-w-0", DETAIL_ITEM_SPANS[span], className)}
    >
      <p className="mb-1 text-label text-muted-foreground">{label}</p>
      <div className="text-body font-medium break-words text-foreground">
        {isEmpty ? <span className="text-muted-foreground">—</span> : (children ?? value)}
      </div>
    </div>
  );
}

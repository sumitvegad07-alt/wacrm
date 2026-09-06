"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { FREQUENCIES, FREQUENCY_LABEL, type Frequency } from "@/lib/dashboard/analytics-period";
import type { NamedValue } from "@/lib/dashboard/sfa-analytics-types";

// Shared building blocks for the SFA and WFA analytics blocks so the two stay
// visually identical and we don't duplicate chart chrome.

export const CHART = {
  order: "#3b82f6",
  sales: "#10b981",
  payment: "#8b5cf6",
  visit: "#06b6d4",
  customer: "#f59e0b",
  grid: "rgba(148,163,184,0.15)",
};

export const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card, 0 0% 100%))",
    border: "1px solid rgba(148,163,184,0.3)",
    borderRadius: 8,
    fontSize: 12,
  },
} as const;

export function FrequencyTabs({
  value,
  onChange,
}: {
  value: Frequency;
  onChange: (f: Frequency) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {FREQUENCIES.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === f
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {FREQUENCY_LABEL[f]}
        </button>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {loading ? (
        <div className="flex h-[220px] items-center justify-center">
          <div className="h-full w-full animate-pulse rounded-lg bg-muted/50" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

/** Shown when an analytics fetch fails — typically an expired session. */
export function AnalyticsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load analytics. Your session may have expired.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

export function TopList({
  items,
  primaryFormat,
  secondaryFormat,
  secondaryLabel,
  emptyLabel = "No data in this period",
}: {
  items?: NamedValue[];
  /** Formats the ranked value (the bar). */
  primaryFormat: (n: number) => string;
  /** Formats the secondary line under each row, if present. */
  secondaryFormat?: (n: number) => string;
  secondaryLabel?: string;
  emptyLabel?: string;
}) {
  if (!items || items.length === 0) return <EmptyChart label={emptyLabel} />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={`${it.name}-${idx}`} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                {idx + 1}
              </span>
              <span className="truncate text-foreground">{it.name}</span>
            </span>
            <span className="ml-2 shrink-0 font-medium tabular-nums text-foreground">
              {primaryFormat(it.value)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          {it.secondary != null && secondaryFormat ? (
            <p className="text-[11px] text-muted-foreground">
              {secondaryFormat(it.secondary)}
              {secondaryLabel ? ` ${secondaryLabel}` : ""}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

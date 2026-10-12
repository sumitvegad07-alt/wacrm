"use client";

import type { ReactNode } from "react";

/**
 * One tooltip for every recharts chart in the app.
 *
 * Two defects this replaces, both reported as "the tooltip text is invisible":
 *
 * 1. The old shared style set `background: hsl(var(--card, 0 0% 100%))`. Our
 *    theme tokens hold COMPLETE colours (`--card: oklch(0.18 0.01 260)`), not
 *    bare HSL channels, so `hsl(oklch(...))` is an invalid colour, the browser
 *    dropped the declaration, and the tooltip rendered with NO background at
 *    all. The series-coloured text then sat straight on top of the bars it was
 *    describing. See the same rule in src/lib/theme/color-fallbacks.test.ts.
 * 2. recharts' default content paints each row in its series colour. A thin
 *    amber or cyan on white fails contrast even once the background is opaque,
 *    so the row name/value are drawn in the normal text colour and the series
 *    is identified by a colour dot instead.
 *
 * The box is also pinned to the TOP of the plot (`position={{ y: 0 }}`) so it
 * never covers the bar or point under the cursor — the x still follows the
 * pointer. This is the same approach the tremor bar chart already used.
 */

type TooltipItem = {
  name?: ReactNode;
  value?: number | string;
  color?: string;
  fill?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

type ChartTooltipContentProps = {
  active?: boolean;
  payload?: TooltipItem[];
  label?: ReactNode;
  /** Passed straight through from <Tooltip formatter={...} />. */
  formatter?: (
    value: unknown,
    name: unknown,
    item: TooltipItem,
    index: number,
    payload: TooltipItem[],
  ) => ReactNode | [ReactNode, ReactNode];
  /** Passed straight through from <Tooltip labelFormatter={...} />. */
  labelFormatter?: (label: unknown, payload: TooltipItem[]) => ReactNode;
};

/**
 * recharts clones this element with the Tooltip's own props merged in
 * (`{...props, payload, label, active}`), which is why `formatter` and
 * `labelFormatter` arrive here without any wiring at the call sites.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;

  const heading = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <div className="pointer-events-none rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      {heading != null && heading !== "" ? (
        <p className="mb-1.5 font-semibold text-popover-foreground">{heading}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((item, index) => {
          const formatted = formatter
            ? formatter(item.value, item.name, item, index, payload)
            : null;
          // A formatter may return either the value alone or a [value, name] pair.
          const value = Array.isArray(formatted) ? formatted[0] : (formatted ?? item.value);
          const name = Array.isArray(formatted) ? formatted[1] : item.name;

          return (
            <li key={`${String(item.dataKey)}-${index}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color ?? item.fill ?? "currentColor" }}
              />
              {name != null && name !== "" ? (
                <span className="text-muted-foreground">{name}</span>
              ) : null}
              <span className="ml-auto pl-3 font-medium tabular-nums text-popover-foreground">
                {value as ReactNode}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Spread onto every `<Tooltip />`: `<Tooltip {...chartTooltipProps} formatter={...} />`.
 *
 * Put it FIRST in the JSX so a chart that genuinely needs a different position
 * (a horizontal bar layout, say) can still override it afterwards.
 */
export const chartTooltipProps = {
  content: <ChartTooltipContent />,
  /** Top of the plot area. x is left undefined so it keeps following the cursor. */
  position: { y: 0 },
  offset: 16,
  wrapperStyle: { outline: "none", zIndex: 30 },
  isAnimationActive: false,
} as const;

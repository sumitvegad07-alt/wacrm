import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { type ReportConfig, type ReportDefinition } from '@/lib/reports/types';
import { formatCurrency, formatCurrencyShort } from '@/lib/currency';

interface ReportBarChartProps {
  data: Record<string, unknown>[];
  config: ReportDefinition;
  reportState: ReportConfig;
  defaultCurrency: string;
  /** Measure to plot. Chosen by the user; falls back to the first selected. */
  measureKey?: string;
}



// Ensure distinct colors
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c'];

export function ReportBarChart({ data, config, reportState, defaultCurrency, measureKey }: ReportBarChartProps) {
  const chartData = useMemo(() => {
    let processData = [...data];
    if (reportState.topN && reportState.topN !== 'all') {
      // Rank by the user's chosen chart measure so "top 10" means top 10 by the
      // column they care about, falling back to the first selected one.
      const rankBy =
        measureKey && reportState.measures.includes(measureKey)
          ? measureKey
          : reportState.measures[0];
      if (rankBy) {
        processData = processData.sort((a, b) => Number(b[rankBy] || 0) - Number(a[rankBy] || 0)).slice(0, reportState.topN as number);
      }
    }

    return processData.map(row => {
      // Create a combined label for X-Axis if multiple dimensions exist
      const labelParts = reportState.dimensions.map(dKey => String(row[dKey] || 'Unknown'));
      const label = labelParts.length > 0 ? labelParts.join(' - ') : 'Total';
      
      const newRow: Record<string, unknown> = { ...row, _label: label };
      // Ensure measures are numbers
      reportState.measures.forEach(mKey => {
        newRow[mKey] = Number(row[mKey]) || 0;
      });
      return newRow;
    });
  }, [data, reportState.dimensions, reportState.measures, reportState.topN, measureKey]);

  if (!data.length || reportState.measures.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data to display in chart
      </div>
    );
  }

  const formatTooltipValue = (value: any, name: string) => {
    const valNum = Number(value);
    const measureDef = config.measures.find(m => m.key === name || m.label === name);
    if (measureDef?.type === 'currency') return formatCurrencyShort(valNum, defaultCurrency);
    if (measureDef?.type === 'percent') return `${valNum.toFixed(2)}%`;
    return valNum.toLocaleString();
  };

  const formatYAxis = (value: any) => {
    const valNum = Number(value);
    if (valNum >= 1000000) return `${(valNum / 1000000).toFixed(1)}M`;
    if (valNum >= 1000) return `${(valNum / 1000).toFixed(1)}k`;
    return String(valNum);
  };

  // One legend entry per plotted measure, with its total across the visible bars —
  // the same shape the donut legend uses for its slices.
  const legendItems = reportState.measures.map((mKey, idx) => {
    const def = config.measures.find(m => m.key === mKey);
    const total = chartData.reduce((sum, row) => sum + (Number(row[mKey]) || 0), 0);
    return {
      key: mKey,
      label: def?.label || mKey,
      color: COLORS[idx % COLORS.length],
      total: formatTooltipValue(total, mKey),
    };
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* overflow-hidden: recharts' ResponsiveContainer rounds its measured height
          up and the SVG then spills over the legend below, swallowing its hovers. */}
      <div className="flex-1 min-h-[220px] overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="_label"
              angle={-45}
              textAnchor="end"
              height={100}
              interval={0}
              tickMargin={8}
              tick={{ fontSize: 11 }}
            />
            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} width={56} />
            <Tooltip
              cursor={{ fillOpacity: 0.08 }}
              formatter={(value: any, name: any) => [
                formatTooltipValue(value, String(name)),
                config.measures.find(m => m.key === name)?.label || String(name)
              ]}
            />
            {reportState.measures.map((mKey, idx) => (
              <Bar
                key={mKey}
                dataKey={mKey}
                name={config.measures.find(m => m.key === mKey)?.label || mKey}
                fill={COLORS[idx % COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend rendered as plain markup rather than recharts' <Legend />, matching
          the donut. recharts drew it inside the plot area, where it collided with
          the angled x-axis labels. */}
      <div className="shrink-0 mt-3 pt-3 border-t max-h-[120px] overflow-y-auto">
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5">
          {legendItems.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-foreground max-w-[180px] truncate" title={item.label}>
                {item.label}
              </span>
              <span className="text-muted-foreground tabular-nums">{item.total}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

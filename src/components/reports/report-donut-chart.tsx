import React, { useMemo } from 'react';
import { type ReportConfig, type ReportDefinition } from '@/lib/reports/types';
import { formatCurrencyShort } from '@/lib/currency';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface ReportDonutChartProps {
  data: Record<string, unknown>[];
  config: ReportDefinition;
  reportState: ReportConfig;
  defaultCurrency: string;
}

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#0f766e', '#a21caf', '#1d4ed8'];

export function ReportDonutChart({ data, config, reportState, defaultCurrency }: ReportDonutChartProps) {
  const chartData = useMemo(() => {
    // We only use the FIRST selected measure for the donut chart
    const measureKey = reportState.measures[0];
    if (!measureKey) return [];

    // Sort data descending
    let processData = [...data].sort((a, b) => Number(b[measureKey] || 0) - Number(a[measureKey] || 0));

    const topN = reportState.topN && reportState.topN !== 'all' ? (reportState.topN as number) : 10;
    
    // Group Top N and Others
    let finalData = [];
    if (processData.length > topN) {
      finalData = processData.slice(0, topN).map(row => {
        const labelParts = reportState.dimensions.map(dKey => String(row[dKey] || 'Unknown'));
        return { name: labelParts.length > 0 ? labelParts.join(' - ') : 'Total', value: Number(row[measureKey]) || 0 };
      });
      
      const othersValue = processData.slice(topN).reduce((sum, row) => sum + (Number(row[measureKey]) || 0), 0);
      if (othersValue > 0) {
        finalData.push({ name: 'Others', value: othersValue });
      }
    } else {
      finalData = processData.map(row => {
        const labelParts = reportState.dimensions.map(dKey => String(row[dKey] || 'Unknown'));
        return { name: labelParts.length > 0 ? labelParts.join(' - ') : 'Total', value: Number(row[measureKey]) || 0 };
      });
    }

    return finalData;
  }, [data, reportState.dimensions, reportState.measures, reportState.topN]);

  if (!data.length || reportState.measures.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data to display in chart
      </div>
    );
  }

  const activeMeasure = config.measures.find(m => m.key === reportState.measures[0]);

  const formatTooltipValue = (value: any) => {
    const valNum = Number(value);
    if (activeMeasure?.type === 'currency') return formatCurrencyShort(valNum, defaultCurrency);
    if (activeMeasure?.type === 'percent') return `${valNum.toFixed(2)}%`;
    return valNum.toLocaleString();
  };

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="mb-2 text-center text-sm font-medium text-muted-foreground shrink-0">
        Showing: {activeMeasure?.label}
      </div>

      {/* overflow-hidden: recharts' ResponsiveContainer rounds its measured height
          up and the SVG then spills over the legend below, swallowing its hovers. */}
      <div className="flex-1 min-h-[220px] overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            {/* The second element of the returned tuple is the tooltip's LABEL. Returning
                the measure label there replaced the slice name, so every slice read
                "# of order : 1" with no clue which customer it was. Return `name`. */}
            <Tooltip
              formatter={(value, name) => [formatTooltipValue(value), String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend rendered as plain markup rather than recharts' <Legend />, which
          silently rendered nothing for this Pie. Showing the value and share next
          to each name is also what makes the donut readable without hovering. */}
      <div className="shrink-0 mt-3 pt-3 border-t max-h-[120px] overflow-y-auto">
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5">
          {chartData.map((entry, index) => (
            // Keyed by index, not name: rows whose dimension value is null all
            // collapse to "Unknown", and during a tab switch the previous tab's
            // rows are briefly read with the new dimension key, so names are not
            // unique. Position is stable for this derived list.
            <li key={`${index}-${entry.name}`} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: COLORS[index % COLORS.length] }}
              />
              <span className="text-foreground max-w-[180px] truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatTooltipValue(entry.value)}
                {total > 0 && ` (${((entry.value / total) * 100).toFixed(1)}%)`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

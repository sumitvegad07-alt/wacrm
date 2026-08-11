import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { type ReportConfig, type ReportDefinition } from '@/lib/reports/types';
import { formatCurrency, formatCurrencyShort } from '@/lib/currency';

interface ReportBarChartProps {
  data: Record<string, unknown>[];
  config: ReportDefinition;
  reportState: ReportConfig;
  defaultCurrency: string;
}



// Ensure distinct colors
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c'];

export function ReportBarChart({ data, config, reportState, defaultCurrency }: ReportBarChartProps) {
  const chartData = useMemo(() => {
    let processData = [...data];
    if (reportState.topN && reportState.topN !== 'all') {
      // Sort by first measure and take top N
      const firstMeasure = reportState.measures[0];
      if (firstMeasure) {
        processData = processData.sort((a, b) => Number(b[firstMeasure] || 0) - Number(a[firstMeasure] || 0)).slice(0, reportState.topN as number);
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
  }, [data, reportState.dimensions, reportState.measures, reportState.topN]);

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

  return (
    <div className="w-full h-full min-h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis 
            dataKey="_label" 
            angle={-45}
            textAnchor="end"
            height={80}
            tick={{ fontSize: 12 }}
          />
          <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} />
          <Tooltip 
            formatter={(value: any, name: any) => [
              formatTooltipValue(value, String(name)), 
              config.measures.find(m => m.key === name)?.label || String(name)
            ]}
          />
          <Legend />
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
  );
}

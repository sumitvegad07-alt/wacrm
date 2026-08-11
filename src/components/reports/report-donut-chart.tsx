import React, { useMemo } from 'react';
import { type ReportConfig, type ReportDefinition } from '@/lib/reports/types';
import { formatCurrencyShort } from '@/lib/currency';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
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

  return (
    <div className="w-full h-full min-h-[400px]">
      <div className="mb-4 text-center text-sm font-medium text-muted-foreground">
        Showing: {activeMeasure?.label}
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={80}
            outerRadius={120}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            formatter={(value: any) => [formatTooltipValue(value), activeMeasure?.label || 'Value']} 
          />
          <Legend layout="horizontal" verticalAlign="bottom" align="center" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

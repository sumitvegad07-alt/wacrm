import React, { useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type ReportConfig, type ReportDefinition } from '@/lib/reports/types';
import { formatCurrency } from '@/lib/currency';
import { groupRowsForSubtotals } from '@/lib/reports/subtotals';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface ReportTableProps {
  data: Record<string, unknown>[];
  config: ReportDefinition;
  reportState: ReportConfig;
  defaultCurrency: string;
  onSort: (column: string, direction: 'asc' | 'desc') => void;
  /** The active tab's TabConfig.showSubtotals. Adds a subtotal row after each
   *  value of the first dimension — see lib/reports/subtotals.ts for why this is
   *  opt-in rather than automatic on any two-dimension table. */
  showSubtotals?: boolean;
}

const CUSTOMER_LEVEL_MAP: Record<string, string> = {
  '1': 'Distributor',
  '2': 'Dealer',
  '3': 'Retailer',
  '4': 'Direct',
};

export function ReportTable({ data, config, reportState, defaultCurrency, onSort, showSubtotals }: ReportTableProps) {
  // Determine visible columns: selected dimensions + selected measures
  const visibleColumns = useMemo(() => {
    const dimCols = reportState.dimensions.map(dKey => {
      const def = config.dimensions.find(d => d.key === dKey);
      return { key: dKey, label: def?.label || dKey, type: 'dimension' };
    });

    const measureCols = reportState.measures.map(mKey => {
      const def = config.measures.find(m => m.key === mKey);
      return {
        key: mKey,
        label: def?.label || mKey,
        type: 'measure',
        format: def?.type || 'number',
        additive: def?.additive !== false,
      };
    });

    return [...dimCols, ...measureCols];
  }, [reportState.dimensions, reportState.measures, config]);

  // Calculate totals for measure columns
  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    if (!data.length) return totals;

    visibleColumns.forEach(col => {
      if (col.type === 'measure') {
        totals[col.key] = data.reduce((acc, row) => acc + (Number(row[col.key]) || 0), 0);
      }
    });

    return totals;
  }, [data, visibleColumns]);

  /** Rows split into subtotal groups, or null when the tab prints a flat table.
   *  Needs two dimension columns: with one, the group column IS the only
   *  dimension and every subtotal would repeat the row above it. */
  const subtotalGroups = useMemo(() => {
    if (!showSubtotals) return null;
    const dimCols = visibleColumns.filter(c => c.type === 'dimension');
    if (dimCols.length < 2) return null;
    const groups = groupRowsForSubtotals(
      data,
      dimCols[0].key,
      visibleColumns
        .filter(c => c.type === 'measure')
        .map(c => {
          const m = c as { key: string; additive?: boolean; format?: string };
          // Same two exclusions the grand-total footer applies: a percentage and
          // anything flagged non-additive do not add up down a column.
          return { key: m.key, additive: m.additive !== false && m.format !== 'percent' };
        }),
    );
    return groups.length ? groups : null;
  }, [showSubtotals, data, visibleColumns]);

  if (!data.length) {
    // Name the period in the empty state. Every report opens on "This Month",
    // and a module whose records all sit in an earlier month then renders a
    // blank table that looks broken rather than out-of-range — which is exactly
    // how it was read. Showing the dates makes the cause obvious.
    const range = reportState.filters?.date_range as
      | { start_date?: string; end_date?: string }
      | undefined;
    const activeFilters = Object.keys(reportState.filters ?? {}).filter(k => k !== 'date_range');

    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-1">
        <p className="text-lg">No records found.</p>
        {range?.start_date && range?.end_date && (
          <p className="text-sm">
            Period: <span className="font-medium text-foreground">{range.start_date}</span> to{' '}
            <span className="font-medium text-foreground">{range.end_date}</span>
          </p>
        )}
        <p className="text-sm">
          {activeFilters.length > 0
            ? `Widen the period, or clear the ${activeFilters.length} other active filter${activeFilters.length > 1 ? 's' : ''}.`
            : 'Try a wider period — there may be records outside these dates.'}
        </p>
      </div>
    );
  }

  const renderCell = (row: Record<string, unknown>, col: Record<string, unknown>) => {
    const value = row[col.key as string];
    if (value === null || value === undefined) return '-';

    if (col.key === 'customer_type' || col.key === 'customer_level') {
      const strVal = String(value);
      return CUSTOMER_LEVEL_MAP[strVal] || strVal || '-';
    }
    
    if (col.type === 'measure') {
      const rowCurrency = (row.currency as string) || defaultCurrency;
      if (col.format === 'currency') return formatCurrency(Number(value), rowCurrency);
      if (col.format === 'percent') return `${Number(value).toFixed(2)}%`;
      return Number(value).toLocaleString();
    }
    
    return String(value);
  };

  const renderTotalCell = (col: Record<string, unknown>, index: number) => {
    if (col.type === 'dimension') {
      if (index === 0) return <span className="font-extrabold text-primary text-sm uppercase tracking-wider">Total</span>;
      return null;
    }

    // Percentages are not summable — adding a column of per-row ratios produces a
    // meaningless number (a lead source at 100% and four at 0% would total 100%
    // when the real overall ratio is 11%). The true figure for the whole result
    // set is the KPI card, which is its own grand-total query.
    if (col.format === 'percent') {
      return <span className="font-bold text-muted-foreground" title="Percentages cannot be summed — see the KPI card above for the overall figure">—</span>;
    }

    // Same reasoning for measures explicitly marked non-additive: Ageing's "Days
    // Since Last Order" is an age per row, and a column of ages does not add up.
    if (col.additive === false) {
      return <span className="font-bold text-muted-foreground" title="This measure is a per-row figure and cannot be summed">—</span>;
    }

    const totalVal = columnTotals[col.key as string] || 0;
    if (col.format === 'currency') return <span className="font-bold text-foreground">{formatCurrency(totalVal, defaultCurrency)}</span>;
    return <span className="font-bold text-foreground">{totalVal.toLocaleString()}</span>;
  };

  /** A group's subtotal line: "<group> total" under the first dimension, the
   *  summed figure under each measure, and a dash where a measure does not sum
   *  (Avg Rate) — the same rule the grand-total footer follows, so the two
   *  rows never disagree about what is addable. */
  const renderSubtotalCell = (
    col: Record<string, unknown>,
    index: number,
    group: { groupKey: string; subtotals: Record<string, number> },
  ) => {
    if (col.type === 'dimension') {
      if (index === 0) {
        return (
          <span className="font-bold text-foreground">
            {group.groupKey} total
          </span>
        );
      }
      return null;
    }

    const value = group.subtotals[col.key as string];
    if (value === undefined) return <span className="text-muted-foreground">—</span>;
    if (col.format === 'currency') {
      return <span className="font-semibold">{formatCurrency(value, defaultCurrency)}</span>;
    }
    return <span className="font-semibold">{value.toLocaleString()}</span>;
  };

  const handleSortClick = (colKey: string) => {
    let newDirection: 'asc' | 'desc' = 'asc';
    if (reportState.sortColumn === colKey) {
      newDirection = reportState.sortDirection === 'asc' ? 'desc' : 'asc';
    }
    onSort(colKey, newDirection);
  };

  return (
    <div className="rounded-md border h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
            <TableRow>
              {visibleColumns.map(col => (
                <TableHead 
                  key={col.key}
                  className={`cursor-pointer select-none hover:bg-muted/50 ${col.type === 'measure' ? 'text-right font-bold text-foreground' : 'font-bold text-foreground'}`}
                  onClick={() => handleSortClick(col.key)}
                >
                  <div className={`flex items-center space-x-1 ${col.type === 'measure' ? 'justify-end' : ''}`}>
                    <span>{col.label}</span>
                    {reportState.sortColumn === col.key ? (
                      reportState.sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-20" />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {subtotalGroups
              ? subtotalGroups.map(group => (
                  <React.Fragment key={`group-${group.groupKey}`}>
                    {group.rows.map((row, i) => (
                      <TableRow key={`${group.groupKey}-${i}`}>
                        {visibleColumns.map(col => (
                          <TableCell
                            key={col.key}
                            className={col.type === 'measure' ? 'text-right' : ''}
                          >
                            {renderCell(row, col)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/60 border-y border-border/80 hover:bg-muted/60">
                      {visibleColumns.map((col, idx) => (
                        <TableCell
                          key={`subtotal-${group.groupKey}-${col.key}`}
                          className={col.type === 'measure' ? 'text-right' : ''}
                        >
                          {renderSubtotalCell(col, idx, group)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </React.Fragment>
                ))
              : data.map((row, i) => (
                  <TableRow key={i}>
                    {visibleColumns.map(col => (
                      <TableCell
                        key={col.key}
                        className={col.type === 'measure' ? 'text-right' : ''}
                      >
                        {renderCell(row, col)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
          <TableFooter className="sticky bottom-0 bg-primary/10 dark:bg-primary/15 backdrop-blur-sm z-10 border-t-2 border-primary/30 font-bold">
            <TableRow>
              {visibleColumns.map((col, idx) => (
                <TableCell
                  key={`total-${col.key}`}
                  className={col.type === 'measure' ? 'text-right' : ''}
                >
                  {renderTotalCell(col, idx)}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}


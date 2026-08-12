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
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface ReportTableProps {
  data: Record<string, unknown>[];
  config: ReportDefinition;
  reportState: ReportConfig;
  defaultCurrency: string;
  onSort: (column: string, direction: 'asc' | 'desc') => void;
}

const CUSTOMER_LEVEL_MAP: Record<string, string> = {
  '1': 'Distributor',
  '2': 'Dealer',
  '3': 'Retailer',
  '4': 'Direct',
};

export function ReportTable({ data, config, reportState, defaultCurrency, onSort }: ReportTableProps) {
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
        format: def?.type || 'number' 
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
  
  if (!data.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-lg">No records found for selected filters.</p>
        <p className="text-sm">Try changing filters or removing constraints.</p>
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

    const totalVal = columnTotals[col.key as string] || 0;
    if (col.format === 'currency') return <span className="font-bold text-foreground">{formatCurrency(totalVal, defaultCurrency)}</span>;
    if (col.format === 'percent') return <span className="font-bold text-foreground">{totalVal.toFixed(2)}%</span>;
    return <span className="font-bold text-foreground">{totalVal.toLocaleString()}</span>;
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
            {data.map((row, i) => (
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


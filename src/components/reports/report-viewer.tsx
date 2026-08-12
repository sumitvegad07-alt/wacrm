"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { type ReportDefinition, type ReportConfig, type TabConfig } from "@/lib/reports/types";
import { executeReport } from "@/app/actions/reports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Loader2, Download, Save, Table as TableIcon, BarChart3, PieChart, 
  Columns, Printer, CalendarDays, Filter, X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportTable } from "./report-table";
import { ReportBarChart } from "./report-bar-chart";
import { ReportDonutChart } from "./report-donut-chart";
import { ReportFilterDrawer, PERIOD_PRESETS, getDatesForPeriod } from "./report-filter-drawer";
import { ReportKpiCards } from "./report-kpi-cards";
import { ReportSaveDialog } from "./report-save-dialog";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

interface ReportViewerProps {
  config: ReportDefinition;
}

export function ReportViewer({ config }: ReportViewerProps) {
  const { defaultCurrency, accountId } = useAuth();
  const supabase = createClient();
  
  // Product settings state (to control category/subcategory tab visibility)
  const [productLevelsCount, setProductLevelsCount] = useState<number>(0);

  // Fetch product settings on mount
  useEffect(() => {
    async function fetchProductSettings() {
      if (!accountId) return;
      const { data } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', accountId)
        .single();
      
      if (data?.settings?.product_settings) {
        setProductLevelsCount(data.settings.product_settings.levels_count || 0);
      }
    }
    fetchProductSettings();
  }, [accountId]);

  // Compute visible tabs based on product settings
  const visibleTabs = useMemo(() => {
    if (!config.tabConfigs) return [];
    return config.tabConfigs.filter(tab => {
      if (tab.requiresProductSettings === 'category') {
        return productLevelsCount >= 1;
      }
      if (tab.requiresProductSettings === 'subcategory') {
        return productLevelsCount >= 2;
      }
      return true;
    });
  }, [config.tabConfigs, productLevelsCount]);

  // Active tab key
  const [activeTab, setActiveTab] = useState<string>('customer');

  // Compute initial date range for "this_month"
  const computeInitialDateFilter = useCallback(() => {
    const range = getDatesForPeriod('this_month');
    if (range?.from && range?.to) {
      return {
        start_date: range.from.toISOString().split('T')[0],
        end_date: range.to.toISOString().split('T')[0],
      };
    }
    return undefined;
  }, []);

  const initialDateRange = useMemo(() => computeInitialDateFilter(), [computeInitialDateFilter]);

  // Get default measures for the active tab
  const getDefaultMeasures = (tabKey: string) => {
    const tab = config.tabConfigs?.find(t => t.key === tabKey);
    return tab?.defaultMeasures || ['gross_amount', 'net_amount', 'order_count', 'product_quantity'];
  };

  const getTabDimension = (tabKey: string) => {
    const tab = config.tabConfigs?.find(t => t.key === tabKey);
    return tab?.dimension || tabKey;
  };

  const [reportState, setReportState] = useState<ReportConfig>({
    dimensions: [getTabDimension('customer')],
    measures: getDefaultMeasures('customer'),
    filters: initialDateRange ? { date_range: initialDateRange } : {},
    view: 'table',
    period: 'this_month',
    sortColumn: undefined,
    sortDirection: 'asc',
    topN: 10
  });

  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const LIMIT = 50;

  // Handle tab change
  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);
    const dimension = getTabDimension(tabKey);
    const measures = getDefaultMeasures(tabKey);

    setReportState(s => {
      let newPeriod = s.period;
      let newFilters = { ...s.filters };

      // If switching to time (month-on-month) tab and period is single-month 'this_month', expand to last_180_days
      if (tabKey === 'time' && s.period === 'this_month') {
        newPeriod = 'last_180_days';
        const range = getDatesForPeriod('last_180_days');
        if (range?.from && range?.to) {
          newFilters.date_range = {
            start_date: range.from.toISOString().split('T')[0],
            end_date: range.to.toISOString().split('T')[0],
          };
        }
      }

      return {
        ...s,
        dimensions: [dimension],
        measures,
        period: newPeriod,
        filters: newFilters,
        sortColumn: undefined,
        sortDirection: 'asc',
      };
    });
    setPage(1);
  };

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const offset = (page - 1) * LIMIT;
      const result = await executeReport(
        config.moduleName,
        reportState.dimensions,
        reportState.measures,
        reportState.filters,
        reportState.sortColumn,
        reportState.sortDirection,
        LIMIT + 1,
        offset
      );
      
      if (result && result.length > LIMIT) {
        setHasMore(true);
        setData(result.slice(0, LIMIT));
      } else {
        setHasMore(false);
        setData(result || []);
      }
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [
    config.moduleName, 
    reportState.dimensions, 
    reportState.measures, 
    reportState.filters, 
    reportState.sortColumn, 
    reportState.sortDirection, 
    page
  ]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    try {
      const exportData = await executeReport(
        config.moduleName,
        reportState.dimensions,
        reportState.measures,
        reportState.filters,
        reportState.sortColumn,
        reportState.sortDirection,
        50000,
        0
      );

      if (!exportData || exportData.length === 0) {
        alert("No data available to export.");
        return;
      }

      if (exportData.length >= 50000) {
        alert("Dataset too large. Please apply more filters before exporting.");
        return;
      }

      if (format === 'csv') {
        const keys = Object.keys(exportData[0]);
        const csvContent = [
          keys.join(","),
          ...exportData.map((row: any) => keys.map(k => {
            let val = row[k] === null || row[k] === undefined ? "" : String(row[k]);
            if (val.includes(",") || val.includes('"')) {
              val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          }).join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${config.label}_export.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (format === 'xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Report Data");
        XLSX.writeFile(workbook, `${config.label}_export.xlsx`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate export");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const toggleMeasure = (mKey: string) => {
    setReportState(s => {
      const isSelected = s.measures.includes(mKey);
      if (isSelected && s.measures.length === 1) return s;
      
      const newMeasures = isSelected 
        ? s.measures.filter(k => k !== mKey)
        : [...s.measures, mKey];
        
      return { ...s, measures: newMeasures };
    });
  };

  // Get the period label for display
  const periodLabel = PERIOD_PRESETS.find(p => p.value === reportState.period)?.label ?? 'This Month';

  // Count active non-date filters
  const activeFilterCount = Object.keys(reportState.filters).filter(k => k !== 'date_range').length;

  return (
    <div className="flex flex-col h-full space-y-4 pb-8 print:space-y-0 print:block">
      {/* Print Header */}
      <div className="hidden print:block mb-8">
        <h1 className="text-3xl font-bold">{config.label}</h1>
        <p className="text-sm text-gray-500 mt-2">Generated On: {new Date().toLocaleString()}</p>
        <p className="text-sm text-gray-500">Period: {periodLabel}</p>
        <hr className="my-4" />
      </div>

      {/* Top Header */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center space-x-2">
          {config.icon && <config.icon className="h-6 w-6 text-muted-foreground" />}
          <h1 className="text-2xl font-semibold tracking-tight">{config.label}</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          <ReportFilterDrawer 
            config={config}
            filters={reportState.filters}
            period={reportState.period}
            onApplyFilters={(filters, period) => {
              setReportState(s => ({ ...s, filters, period }));
              setPage(1);
            }}
          />
          
          <ReportSaveDialog moduleName={config.moduleName} reportState={reportState} />

          <DropdownMenu>
            <DropdownMenuTrigger 
              render={
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                Download as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                Download as Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" /> Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ReportKpiCards config={config} filters={reportState.filters} defaultCurrency={defaultCurrency} />

      {/* Tab Navigation + View Toggles */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left: Period badge + Horizontal Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Period Select Dropdown */}
            <Select 
              value={reportState.period} 
              onValueChange={(val) => {
                if (!val) return;
                const newPeriod = val;
                const range = getDatesForPeriod(newPeriod);
                setReportState(s => {
                  const nextFilters = { ...s.filters };
                  if (range?.from && range?.to) {
                    nextFilters.date_range = {
                      start_date: range.from.toISOString().split('T')[0],
                      end_date: range.to.toISOString().split('T')[0],
                    };
                  } else {
                    delete nextFilters.date_range;
                  }
                  return {
                    ...s,
                    period: newPeriod,
                    filters: nextFilters
                  };
                });
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 min-w-[135px] text-xs bg-background gap-1.5 font-semibold">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Select Period" />
              </SelectTrigger>
              <SelectContent align="start" className="w-48">
                {PERIOD_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value} className="text-xs">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="h-4 w-px bg-border hidden sm:block mx-1" />

            {/* Horizontal Tab Bar */}
            <div className="flex flex-wrap items-center gap-1">
              {visibleTabs.map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => handleTabChange(tab.key)}
                    className={`
                      px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150
                      ${isActive 
                        ? 'bg-primary text-primary-foreground shadow-sm' 
                        : 'text-muted-foreground hover:bg-background hover:text-foreground border border-transparent hover:border-border'
                      }
                    `}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: TopN (charts only) + View toggles */}
          <div className="flex items-center gap-1.5">
            {reportState.view !== 'table' && (
              <Select 
                value={reportState.topN?.toString()} 
                onValueChange={(val) => setReportState(s => ({...s, topN: val === 'all' ? 'all' : parseInt(val || '10')}))}
              >
                <SelectTrigger className="h-8 w-[90px] text-sm bg-background mr-1">
                  <SelectValue placeholder="Top N" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Top 10</SelectItem>
                  <SelectItem value="20">Top 20</SelectItem>
                  <SelectItem value="50">Top 50</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            )}

            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 gap-0.5">
              <Button 
                variant={reportState.view === 'table' ? 'default' : 'ghost'} 
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setReportState(s => ({...s, view: 'table'}))}
              >
                <TableIcon className="h-3.5 w-3.5" />
              </Button>
              <Button 
                variant={reportState.view === 'bar' ? 'default' : 'ghost'} 
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setReportState(s => ({...s, view: 'bar'}))}
              >
                <BarChart3 className="h-3.5 w-3.5" />
              </Button>
              <Button 
                variant={reportState.view === 'donut' ? 'default' : 'ghost'} 
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setReportState(s => ({...s, view: 'donut'}))}
              >
                <PieChart className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <Card className="flex-1 min-h-[450px] max-h-[680px] p-4 pb-6 flex flex-col relative print:border-none print:shadow-none print:p-0">
        {loading && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-20 print:hidden">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        
        <div className="flex-1 flex flex-col overflow-hidden">
          {reportState.view === 'table' && (
            <>
              <div className="flex-1 overflow-auto min-h-0">
                <ReportTable 
                  data={data} 
                  config={config} 
                  reportState={reportState} 
                  defaultCurrency={defaultCurrency}
                  onSort={(column, direction) => {
                    setReportState(s => ({ ...s, sortColumn: column, sortDirection: direction }));
                    setPage(1);
                  }}
                />
              </div>
              {data.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pt-3 pb-1 border-t mt-2 print:hidden bg-background gap-3">
                  {/* Left: Show X Rows per page | Manage Columns */}
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <div className="flex items-center space-x-1.5">
                      <span>Show</span>
                      <Select 
                        value={LIMIT.toString()} 
                        onValueChange={(val) => {
                          setPage(1);
                        }}
                      >
                        <SelectTrigger className="h-7 w-[60px] text-xs bg-background">
                          <SelectValue placeholder="20" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="20">20</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                        </SelectContent>
                      </Select>
                      <span>Rows per page</span>
                    </div>

                    <div className="h-4 w-px bg-border" />

                    <DropdownMenu>
                      <DropdownMenuTrigger 
                        render={
                          <Button variant="outline" size="sm" className="h-7 text-xs uppercase font-semibold tracking-wider">
                            Manage Column
                          </Button>
                        } 
                      />
                      <DropdownMenuContent align="start" className="w-56">
                        {config.measures.map(m => (
                          <DropdownMenuCheckboxItem
                            key={m.key}
                            checked={reportState.measures.includes(m.key)}
                            onCheckedChange={() => toggleMeasure(m.key)}
                          >
                            {m.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Right: Pagination */}
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-muted-foreground">
                      {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, (page - 1) * LIMIT + data.length)}
                    </span>
                    <div className="flex items-center space-x-1">
                      <Button 
                        variant="outline" 
                        size="icon-sm" 
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="h-7 w-7 p-0 cursor-pointer"
                      >
                        ‹
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon-sm" 
                        onClick={() => setPage(p => p + 1)}
                        disabled={!hasMore}
                        className="h-7 w-7 p-0 cursor-pointer"
                      >
                        ›
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {reportState.view === 'bar' && (
            <ReportBarChart data={data} config={config} reportState={reportState} defaultCurrency={defaultCurrency} />
          )}
          {reportState.view === 'donut' && (
            <ReportDonutChart data={data} config={config} reportState={reportState} defaultCurrency={defaultCurrency} />
          )}
        </div>
      </Card>
    </div>
  );
}

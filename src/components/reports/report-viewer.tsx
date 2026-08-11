"use client";

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { type ReportDefinition, type ReportConfig } from "@/lib/reports/types";
import { executeReport } from "@/app/actions/reports";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Loader2, Download, Save, Table as TableIcon, BarChart3, PieChart, 
  Columns, Printer, CalendarDays, ChevronRight, Filter, X
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
import { ReportFilterDrawer, PERIOD_PRESETS } from "./report-filter-drawer";
import { ReportKpiCards } from "./report-kpi-cards";
import { ReportSaveDialog } from "./report-save-dialog";
import { AsyncSearchSelect } from "@/components/ui/async-search-select";
import { useAuth } from "@/hooks/use-auth";

interface ReportViewerProps {
  config: ReportDefinition;
}

export function ReportViewer({ config }: ReportViewerProps) {
  const { defaultCurrency } = useAuth();
  
  const [reportState, setReportState] = useState<ReportConfig>({
    dimensions: [], // Initially empty
    measures: ['gross_amount', 'net_amount', 'order_count', 'product_quantity'], // Default 4 measures requested
    filters: {},
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

  // Separate hierarchical group by state for cleaner UI
  const [groupLevel1, setGroupLevel1] = useState<string>("none");
  const [groupLevel2, setGroupLevel2] = useState<string>("none");
  const [groupLevel3, setGroupLevel3] = useState<string>("none");

  // Sync group levels to reportState.dimensions
  useEffect(() => {
    const newDims = [groupLevel1, groupLevel2, groupLevel3].filter(d => d !== "none");
    setReportState(s => ({ ...s, dimensions: newDims }));
    setPage(1); // Reset page on group change
  }, [groupLevel1, groupLevel2, groupLevel3]);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const offset = (page - 1) * LIMIT;
      // Fetch LIMIT + 1 to know if there's a next page
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
      // Fetch all data for export without pagination (limit 50000)
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
      if (isSelected && s.measures.length === 1) return s; // prevent removing all
      
      const newMeasures = isSelected 
        ? s.measures.filter(k => k !== mKey)
        : [...s.measures, mKey];
        
      return { ...s, measures: newMeasures };
    });
  };

  const updateQuickFilter = (key: string, value: any) => {
    setReportState(s => {
      const nextFilters = { ...s.filters };
      if (!value || value === "none") {
        delete nextFilters[key];
      } else if (key === 'customer') {
        nextFilters[key] = { contact_id: value };
      } else {
        nextFilters[key] = value;
      }
      return { ...s, filters: nextFilters };
    });
    setPage(1);
  };

  // Returns allowed child dimensions for a given parent key.
  const getAvailableChildDimensions = (parentKey: string, alreadyUsed: string[]) => {
    const parentDef = config.dimensions.find(d => d.key === parentKey);
    const allowed = parentDef?.allowedChildDimensions;
    return config.dimensions.filter(d => {
      if (alreadyUsed.includes(d.key)) return false; // already selected at a higher level
      if (allowed && allowed.length > 0) return allowed.includes(d.key); // whitelist
      return true; // no restriction — all other dimensions available
    });
  };

  return (
    <div className="flex flex-col h-full space-y-4 pb-8 print:space-y-0 print:block">
      {/* Print Header (Only visible when printing) */}
      <div className="hidden print:block mb-8">
        <h1 className="text-3xl font-bold">{config.label}</h1>
        <p className="text-sm text-gray-500 mt-2">Generated On: {new Date().toLocaleString()}</p>
        <p className="text-sm text-gray-500">Period: {reportState.period}</p>
        <hr className="my-4" />
      </div>

      {/* Top Header (Hidden on print) */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center space-x-2">
          {config.icon && <config.icon className="h-6 w-6 text-muted-foreground" />}
          <h1 className="text-2xl font-semibold tracking-tight">{config.label}</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          <DropdownMenu>
            <DropdownMenuTrigger 
              render={
                <Button variant="outline" size="sm">
                  <Columns className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              } 
            />
            <DropdownMenuContent align="end" className="w-56">
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

      {/* Main Controls Panel: Group By + Quick Filters + View Toggles */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3 print:hidden">
        {/* Row 1: Group By & View Toggles */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left: Period badge + Group By */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-background border border-border rounded-md px-2.5 py-1.5 mr-2">
              <CalendarDays className="h-3.5 w-3.5" />
              {PERIOD_PRESETS.find(p => p.value === reportState.period)?.label ?? 'This Month'}
            </div>

            <div className="h-4 w-px bg-border hidden sm:block" />

            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-1">Group By</span>

            {/* Level 1 */}
            <Select value={groupLevel1} onValueChange={(val) => {
              setGroupLevel1(val || "none");
              setGroupLevel2("none");
              setGroupLevel3("none");
            }}>
              <SelectTrigger className="h-8 min-w-[140px] text-sm bg-background">
                <SelectValue placeholder="Level 1" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {config.dimensions.map(d => (
                  <SelectItem key={`l1-${d.key}`} value={d.key}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Level 2 */}
            {groupLevel1 !== "none" && (() => {
              const level2Options = getAvailableChildDimensions(groupLevel1, [groupLevel1]);
              return level2Options.length > 0 ? (
                <>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  <Select value={groupLevel2} onValueChange={(val) => {
                    setGroupLevel2(val || "none");
                    setGroupLevel3("none");
                  }}>
                    <SelectTrigger className="h-8 min-w-[140px] text-sm bg-background">
                      <SelectValue placeholder="Level 2" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {level2Options.map(d => (
                        <SelectItem key={`l2-${d.key}`} value={d.key}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null;
            })()}

            {/* Level 3 */}
            {groupLevel2 !== "none" && groupLevel1 !== "none" && (() => {
              const level3Options = getAvailableChildDimensions(groupLevel2, [groupLevel1, groupLevel2]);
              return level3Options.length > 0 ? (
                <>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  <Select value={groupLevel3} onValueChange={(val) => setGroupLevel3(val || "none")}>
                    <SelectTrigger className="h-8 min-w-[140px] text-sm bg-background">
                      <SelectValue placeholder="Level 3" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {level3Options.map(d => (
                        <SelectItem key={`l3-${d.key}`} value={d.key}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null;
            })()}
          </div>

          {/* Right: TopN + View toggles */}
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

        {/* Row 2: Quick Filter Dropdowns Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Quick Filters</span>
          
          {/* Customer Filter */}
          <div className="w-[160px]">
            <AsyncSearchSelect
              tableName="customers"
              value={reportState.filters['customer']?.contact_id || ""}
              onChange={(val) => updateQuickFilter('customer', val)}
              placeholder="All Customers"
              className="h-8 text-xs bg-background"
            />
          </div>

          {/* Product Filter */}
          <div className="w-[150px]">
            <AsyncSearchSelect
              tableName="products"
              value={reportState.filters['product'] || ""}
              onChange={(val) => updateQuickFilter('product', val)}
              placeholder="All Products"
              className="h-8 text-xs bg-background"
            />
          </div>

          {/* Customer Level Filter */}
          <Select 
            value={reportState.filters['customer_type'] || "none"} 
            onValueChange={(val) => updateQuickFilter('customer_type', val)}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs bg-background">
              <SelectValue placeholder="Customer Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All Levels</SelectItem>
              <SelectItem value="1">Distributor (1)</SelectItem>
              <SelectItem value="2">Dealer (2)</SelectItem>
              <SelectItem value="3">Retailer (3)</SelectItem>
            </SelectContent>
          </Select>

          {/* Sales Type Filter */}
          <Select 
            value={reportState.filters['sales_type'] || "none"} 
            onValueChange={(val) => updateQuickFilter('sales_type', val)}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs bg-background">
              <SelectValue placeholder="Sales Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All Sales Types</SelectItem>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear Filters Button if any quick filter active */}
          {Object.keys(reportState.filters).filter(k => k !== 'date_range').length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                const dateFilter = reportState.filters.date_range ? { date_range: reportState.filters.date_range } : {};
                setReportState(s => ({ ...s, filters: dateFilter }));
                setPage(1);
              }}
            >
              <X className="mr-1 h-3 w-3" /> Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Content Area — Ensure visible height & space for footer */}
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
                          // Page limit selector
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

                  {/* Right: < 1 - 8 > Pagination */}
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

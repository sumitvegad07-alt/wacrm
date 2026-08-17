"use client";

import { useState, useEffect, useMemo } from "react";
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, startOfQuarter, endOfQuarter, startOfDay, endOfDay, subMonths, subQuarters, subYears } from "date-fns";
import { X, Filter as FilterIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { AsyncSearchSelect } from "@/components/ui/async-search-select";
import { type ReportDefinition, type ReportFilterDef } from "@/lib/reports/types";
import { DateRange } from "react-day-picker";

interface ReportFilterDrawerProps {
  config: ReportDefinition;
  filters: Record<string, any>;
  onApplyFilters: (filters: Record<string, any>, period: string) => void;
  period: string;
}

/**
 * Format a Date as the calendar day the user actually picked.
 *
 * NEVER use `toISOString().split('T')[0]` here. The date pickers produce local
 * midnight, and in any timezone east of UTC that serialises to the PREVIOUS day
 * (IST 2026-08-14T00:00+05:30 → "2026-08-13T18:30Z" → "2026-08-13"). Every report
 * was silently querying one day early on the start of every range.
 */
export function toReportDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export const PERIOD_PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This Week", value: "this_week" },
  { label: "Last Week", value: "last_week" },
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "This Quarter", value: "this_quarter" },
  { label: "Previous Quarter", value: "previous_quarter" },
  { label: "Current Year", value: "current_year" },
  { label: "Previous Year", value: "previous_year" },
  { label: "Last 90 Days", value: "last_90_days" },
  { label: "Last 180 Days", value: "last_180_days" },
  { label: "Last 365 Days", value: "last_365_days" },
  { label: "Custom Range", value: "custom" },
];

export function getDatesForPeriod(period: string, customRange?: DateRange): DateRange | undefined {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday":
      return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
    case "this_week":
      return { from: startOfWeek(now), to: endOfWeek(now) };
    case "last_week":
      return { from: startOfWeek(subDays(now, 7)), to: endOfWeek(subDays(now, 7)) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "last_month":
      return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) };
    case "this_quarter":
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    case "previous_quarter":
      return { from: startOfQuarter(subQuarters(now, 1)), to: endOfQuarter(subQuarters(now, 1)) };
    case "current_year":
      return { from: startOfYear(now), to: endOfYear(now) };
    case "previous_year":
      return { from: startOfYear(subYears(now, 1)), to: endOfYear(subYears(now, 1)) };
    case "last_90_days":
      return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    case "last_180_days":
      return { from: startOfDay(subDays(now, 180)), to: endOfDay(now) };
    case "last_365_days":
      return { from: startOfDay(subDays(now, 365)), to: endOfDay(now) };
    case "custom":
      return customRange;
    default:
      return undefined;
  }
}

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { TerritoryLevel } from "@/lib/territories/types";

export function ReportFilterDrawer({
  config,
  filters: initialFilters,
  onApplyFilters,
  period: initialPeriod,
}: ReportFilterDrawerProps) {
  const { accountId } = useAuth();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<Record<string, any>>(initialFilters);
  const [localPeriod, setLocalPeriod] = useState(initialPeriod);
  const [customDate, setCustomDate] = useState<DateRange | undefined>(
    initialPeriod === "custom" && initialFilters.date_range ? {
        from: new Date(initialFilters.date_range.from),
        to: new Date(initialFilters.date_range.to)
    } : undefined
  );

  const [customerHierarchyEnabled, setCustomerHierarchyEnabled] = useState(false);
  const [productLevelsCount, setProductLevelsCount] = useState<number | null>(null);
  const [territoryLevels, setTerritoryLevels] = useState<TerritoryLevel[] | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      if (!accountId) return;
      try {
        const { data, error } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
        if (error) throw error;
        if (data?.settings) {
          const s = data.settings;
          setCustomerHierarchyEnabled(s.order_settings?.enabled ?? s.order_settings?.hierarchy_enabled ?? false);
          // Level 1 Category is a mandatory hierarchy level by default
          setProductLevelsCount(s.product_settings?.levels_count ?? 1);
          setTerritoryLevels((s.territory_settings?.levels as TerritoryLevel[]) ?? null);
        }
        setSettingsLoaded(true);
      } catch (err) {
        console.error("Failed to load settings:", err);
        setSettingsError(true);
      }
    }
    loadSettings();
  }, [accountId]);

  // Generate dynamic config filters
  const dynamicConfigFilters = useMemo(() => {
    let baseFilters = config.filters.filter(f => f.type !== 'territory');
    
    // Add dynamic territory filters
    if (territoryLevels) {
      const activeTerritoryLevels = territoryLevels.filter(l => l.enabled !== false).sort((a, b) => a.position - b.position);
      const territoryFilters = activeTerritoryLevels.map((l: any) => ({
        key: `territory_${l.position}`,
        label: l.name,
        type: 'territory' as const,
        section: 'AREA' as const,
        territoryLevel: l.position
      }));
      baseFilters = [...baseFilters, ...territoryFilters];
    }
    return baseFilters;
  }, [config.filters, territoryLevels]);

  const isFilterVisible = (filterDef: ReportFilterDef) => {
    // 1. Customer Hierarchy filters
    if (['sales_type', 'customer_type', 'user_role', 'hierarchy_level'].includes(filterDef.key)) {
      if (!customerHierarchyEnabled) return false;
    }

    // 2. Product Category & Sub-Category
    if (filterDef.key === 'product_category' && (productLevelsCount === null || productLevelsCount < 1)) {
      return false;
    }
    if (filterDef.key === 'product_subcategory' && (productLevelsCount === null || productLevelsCount < 2)) {
      return false;
    }

    return true;
  };

  const handleApply = () => {
    const finalFilters = { ...localFilters };
    
    // Apply period
    const range = getDatesForPeriod(localPeriod, customDate);
    if (range?.from && range?.to) {
      finalFilters.date_range = {
        start_date: toReportDate(range.from),
        end_date: toReportDate(range.to),
      };
    } else {
      delete finalFilters.date_range;
    }

    onApplyFilters(finalFilters, localPeriod);
    setOpen(false);
  };

  const clearFilters = () => {
    setLocalFilters({});
    setLocalPeriod("this_month");
    setCustomDate(undefined);
    
    const range = getDatesForPeriod("this_month");
    const resetFilters: Record<string, any> = {};
    if (range?.from && range?.to) {
      resetFilters.date_range = {
        start_date: toReportDate(range.from),
        end_date: toReportDate(range.to),
      };
    }
    onApplyFilters(resetFilters, "this_month");
    setOpen(false);
  };

  // Section headings come from the report's own filters rather than a fixed list,
  // so each module groups its filters its own way — payments have no PRODUCT
  // section at all, and gain a PAYMENT one. PERIOD is always rendered first.
  const sections = useMemo(() => {
    const found = dynamicConfigFilters
      .map(f => f.section)
      .filter((s): s is string => Boolean(s) && s !== 'PERIOD');
    const ordered = ['PERIOD', ...Array.from(new Set(found))];
    // Anything without a section used to be dumped into PRODUCT, which silently
    // hid it on any module that has no PRODUCT section.
    const hasUnsectioned = dynamicConfigFilters.some(f => !f.section && f.key !== 'date_range');
    return hasUnsectioned ? [...ordered, 'OTHER'] : ordered;
  }, [dynamicConfigFilters]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" size="sm">
          <FilterIcon className="mr-2 h-4 w-4" />
          Filters
          {Object.keys(initialFilters).length > (initialFilters.date_range ? 1 : 0) && (
            <span className="ml-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {Object.keys(initialFilters).length - (initialFilters.date_range ? 1 : 0)}
            </span>
          )}
        </Button>
      } />
      <SheetContent showCloseButton={false} className="w-[380px] sm:w-[450px] flex flex-col p-0">
        {/* Header matching Screenshot 3: < Filters | CLEAR | [Blue checkmark Apply] */}
        <div className="p-4 border-b flex items-center justify-between bg-background">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
              <span className="text-lg">‹</span>
            </Button>
            <h2 className="text-base font-semibold">Filters</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" className="h-8 text-xs font-semibold px-3 uppercase tracking-wider" onClick={clearFilters}>
              CLEAR
            </Button>
            <Button size="sm" className="h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center" onClick={handleApply}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {!settingsLoaded && !settingsError && (
            <div className="text-sm text-muted-foreground p-4 text-center">Loading configuration...</div>
          )}
          {settingsError && (
            <div className="text-sm text-destructive p-4 text-center bg-destructive/10 rounded-md">Configuration missing — unable to load filters.</div>
          )}
          
          {settingsLoaded && !settingsError && sections.map(section => {
            const sectionFilters = dynamicConfigFilters.filter(f =>
              (f.section === section || (!f.section && section === 'OTHER' && f.key !== 'date_range')) &&
              isFilterVisible(f)
            );
            if (section === 'PERIOD') {
              return (
                <div key={section} className="space-y-3 pb-4 border-b border-border/40">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/80">PERIOD</h3>
                  <div className="space-y-2">
                    <Select value={localPeriod} onValueChange={(val) => setLocalPeriod(val || "this_month")}>
                      <SelectTrigger className="h-9 text-sm bg-background">
                        <SelectValue placeholder="Select Period" />
                      </SelectTrigger>
                      <SelectContent>
                        {PERIOD_PRESETS.map(preset => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    {localPeriod === "custom" && (
                      <div className="pt-2">
                        <DatePickerWithRange date={customDate} setDate={setCustomDate} className="w-full" />
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            if (sectionFilters.length === 0) return null;

            return (
              <div key={section} className="space-y-3 pb-4 border-b border-border/40 last:border-b-0">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/80">{section}</h3>
                {sectionFilters.map(filterDef => (
                  <div key={filterDef.key} className="grid grid-cols-3 items-center gap-2">
                    <Label className="text-xs text-muted-foreground font-normal col-span-1">{filterDef.label}</Label>
                    <div className="col-span-2">
                      {filterDef.type === 'select' && filterDef.options ? (
                        <div className="relative flex items-center">
                          <Select 
                            value={localFilters[filterDef.key] || "none"} 
                            onValueChange={(val) => {
                              const next = { ...localFilters };
                              if (val === "none") delete next[filterDef.key];
                              else next[filterDef.key] = val;
                              setLocalFilters(next);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs bg-background w-full pr-8">
                              <SelectValue placeholder={`Select ${filterDef.label}`} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select {filterDef.label}</SelectItem>
                              {filterDef.options.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {localFilters[filterDef.key] && localFilters[filterDef.key] !== "none" && (
                            <button
                              type="button"
                              className="absolute right-7 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted z-10"
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = { ...localFilters };
                                delete next[filterDef.key];
                                setLocalFilters(next);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ) : filterDef.type === 'territory' ? (
                        <AsyncSearchSelect
                          tableName="territories"
                          displayColumn="name"
                          valueColumn="id"
                          filterColumn={filterDef.territoryLevel && filterDef.territoryLevel > 1 ? "parent_id" : "level"}
                          filterValue={
                            filterDef.territoryLevel && filterDef.territoryLevel > 1 
                            ? localFilters[`territory_${filterDef.territoryLevel - 1}`] || null // pass parent id
                            : filterDef.territoryLevel
                          }
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) {
                              delete next[filterDef.key];
                              // Clear all lower level territories too
                              if (filterDef.territoryLevel) {
                                for (let l = filterDef.territoryLevel + 1; l <= 5; l++) {
                                  delete next[`territory_${l}`];
                                }
                              }
                            } else {
                              next[filterDef.key] = val;
                              // Clear lower level territories when parent changes
                              if (filterDef.territoryLevel) {
                                for (let l = filterDef.territoryLevel + 1; l <= 5; l++) {
                                  delete next[`territory_${l}`];
                                }
                              }
                            }
                            setLocalFilters(next);
                          }}
                          placeholder={`Search ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : filterDef.type === 'customer' ? (
                        <AsyncSearchSelect
                          tableName="contacts"
                          displayColumn="name"
                          value={localFilters[filterDef.key]?.contact_id || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = { contact_id: val };
                            setLocalFilters(next);
                          }}
                          placeholder={`Select ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : filterDef.type === 'product' ? (
                        <AsyncSearchSelect
                          tableName="products"
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                          placeholder={`Select ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : filterDef.type === 'user' ? (
                        <AsyncSearchSelect
                          tableName="profiles"
                          displayColumn="full_name"
                          valueColumn="user_id"
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                          placeholder={`Select ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : filterDef.type === 'lead' ? (
                        <AsyncSearchSelect
                          tableName="leads"
                          displayColumn="name"
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                          placeholder={`Select ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : filterDef.type === 'lookup' ? (
                        // Account-configurable lists (payment types, lead sources,
                        // statuses, industries, pipelines). Looked up live so
                        // options added in settings appear without a code change.
                        <AsyncSearchSelect
                          tableName={filterDef.lookupTable ?? ''}
                          displayColumn="name"
                          valueColumn={filterDef.lookupValueColumn ?? 'name'}
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                          placeholder={`Select ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : (filterDef.key === 'product_category' || filterDef.key === 'product_subcategory') ? (
                        <AsyncSearchSelect
                          tableName="product_categories"
                          value={localFilters[filterDef.key] || ""}
                          onChange={(val) => {
                            const next = { ...localFilters };
                            if (!val) delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                          placeholder={`Search ${filterDef.label}`}
                          className="h-8 text-xs bg-background"
                        />
                      ) : (
                        <input
                          className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs outline-none"
                          placeholder={`Select ${filterDef.label}`}
                          value={localFilters[filterDef.key] || ""}
                          onChange={(e) => {
                            const next = { ...localFilters };
                            if (!e.target.value) delete next[filterDef.key];
                            else next[filterDef.key] = e.target.value;
                            setLocalFilters(next);
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

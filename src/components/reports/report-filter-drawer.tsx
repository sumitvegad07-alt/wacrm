"use client";

import { useState } from "react";
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, startOfQuarter, endOfQuarter, startOfDay, endOfDay, subMonths, subQuarters, subYears } from "date-fns";
import { X, Filter as FilterIcon } from "lucide-react";
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
import { type ReportDefinition } from "@/lib/reports/types";
import { DateRange } from "react-day-picker";

interface ReportFilterDrawerProps {
  config: ReportDefinition;
  filters: Record<string, any>;
  onApplyFilters: (filters: Record<string, any>, period: string) => void;
  period: string;
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
  { label: "Last 180 Days", value: "last_180_days" },
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
    case "last_180_days":
      return { from: startOfDay(subDays(now, 180)), to: endOfDay(now) };
    case "custom":
      return customRange;
    default:
      return undefined;
  }
}

import { Check } from "lucide-react";

export function ReportFilterDrawer({
  config,
  filters: initialFilters,
  onApplyFilters,
  period: initialPeriod,
}: ReportFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<Record<string, any>>(initialFilters);
  const [localPeriod, setLocalPeriod] = useState(initialPeriod);
  const [customDate, setCustomDate] = useState<DateRange | undefined>(
    initialPeriod === "custom" && initialFilters.date_range ? {
        from: new Date(initialFilters.date_range.from),
        to: new Date(initialFilters.date_range.to)
    } : undefined
  );

  const handleApply = () => {
    const finalFilters = { ...localFilters };
    
    // Apply period
    const range = getDatesForPeriod(localPeriod, customDate);
    if (range?.from && range?.to) {
      finalFilters.date_range = {
        start_date: range.from.toISOString().split('T')[0],
        end_date: range.to.toISOString().split('T')[0],
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
  };

  // Group filters by section
  const sections = ['PERIOD', 'SALES TYPE', 'AREA', 'USER', 'CUSTOMER', 'PRODUCT'];

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
      <SheetContent className="w-[380px] sm:w-[450px] flex flex-col p-0">
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
          {sections.map(section => {
            const sectionFilters = config.filters.filter(f => f.section === section || (!f.section && section === 'PRODUCT' && f.key !== 'date_range'));
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
                        <Select 
                          value={localFilters[filterDef.key] || "none"} 
                          onValueChange={(val) => {
                            const next = { ...localFilters };
                            if (val === "none") delete next[filterDef.key];
                            else next[filterDef.key] = val;
                            setLocalFilters(next);
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs bg-background">
                            <SelectValue placeholder={`Select ${filterDef.label}`} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Select {filterDef.label}</SelectItem>
                            {filterDef.options.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : filterDef.type === 'customer' ? (
                        <AsyncSearchSelect
                          tableName="customers"
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

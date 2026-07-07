"use client";

import { useState } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColumnDef, FilterState } from "./data-table-types";
import { TableHead } from "@/components/ui/table";

interface DataTableHeaderProps<T> {
  column: ColumnDef<T>;
  filterValue: any;
  onFilterChange: (id: string, value: any) => void;
}

export function DataTableHeader<T>({ column, filterValue, onFilterChange }: DataTableHeaderProps<T>) {
  const [open, setOpen] = useState(false);

  // If no type is specified, it's just a text header without a filter
  if (!column.type) {
    return (
      <TableHead className="font-semibold text-foreground whitespace-nowrap">
        {column.label}
      </TableHead>
    );
  }

  const renderFilterContent = () => {
    switch (column.type) {
      case "text":
        return (
          <div className="p-3 w-64 space-y-3">
            <Input
              placeholder={`Search ${column.label}...`}
              value={filterValue || ""}
              onChange={(e) => onFilterChange(column.id, e.target.value)}
              className="h-8"
              autoFocus
            />
            <div className="flex justify-between items-center mt-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  onFilterChange(column.id, "");
                  setOpen(false);
                }}
                className="h-7 text-xs text-muted-foreground"
              >
                Clear
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        );

      case "select":
        const activeOptions = (filterValue as string[]) || [];
        
        return (
          <div className="p-2 w-56">
            <div className="px-2 pb-2 mb-2 border-b border-border text-sm font-medium">
              Filter by {column.label}
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 p-1">
              {column.options?.map((opt) => {
                const isActive = activeOptions.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={isActive}
                      onCheckedChange={(checked) => {
                        let next = [...activeOptions];
                        if (checked) next.push(opt.value);
                        else next = next.filter(v => v !== opt.value);
                        
                        onFilterChange(column.id, next.length > 0 ? next : null);
                      }}
                      className="size-4"
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-border px-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  onFilterChange(column.id, null);
                  setOpen(false);
                }}
                className="h-7 text-xs text-muted-foreground"
              >
                Clear
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        );

      case "date":
        const dateOptions = [
          { label: "Today", value: "today" },
          { label: "Yesterday", value: "yesterday" },
          { label: "Last Week", value: "last_week" },
          { label: "Current month", value: "current_month" },
          { label: "Current quarter", value: "current_quarter" },
          { label: "Current financial year", value: "current_year" },
          { label: "Previous month", value: "previous_month" },
          { label: "Custom Range...", value: "custom" },
        ];
        
        const isCustom = Array.isArray(filterValue) || filterValue === "custom";
        const customStart = Array.isArray(filterValue) ? filterValue[0] : "";
        const customEnd = Array.isArray(filterValue) ? filterValue[1] : "";
        
        return (
          <div className="p-2 w-64">
            {!isCustom ? (
              <div className="space-y-1">
                {dateOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-sm flex items-center justify-between ${
                      filterValue === opt.value ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                    }`}
                    onClick={() => {
                      if (opt.value === "custom") {
                        onFilterChange(column.id, ["", ""]);
                      } else {
                        onFilterChange(column.id, filterValue === opt.value ? null : opt.value);
                        setOpen(false);
                      }
                    }}
                  >
                    {opt.label}
                    {filterValue === opt.value && <Check className="size-4" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-4">
                <div className="text-sm font-medium border-b border-border pb-2">Custom Date Range</div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Start Date</label>
                    <Input 
                      type="date" 
                      className="h-8" 
                      value={customStart}
                      onChange={(e) => onFilterChange(column.id, [e.target.value, customEnd])}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">End Date</label>
                    <Input 
                      type="date" 
                      className="h-8" 
                      value={customEnd}
                      onChange={(e) => onFilterChange(column.id, [customStart, e.target.value])}
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => onFilterChange(column.id, null)}
                    className="h-7 text-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      
      default:
        return null;
    }
  };

  const isActive = filterValue !== null && filterValue !== undefined && filterValue !== "" && (!Array.isArray(filterValue) || filterValue.length > 0);

  return (
    <TableHead className="font-semibold text-foreground whitespace-nowrap px-3 transition-colors hover:bg-muted/30">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex items-center gap-1.5 w-full h-full text-left py-2 outline-none group">
          <Search className={`size-3.5 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
          <span className={isActive ? "text-primary" : ""}>{column.label}</span>
          <ChevronDown className={`size-3.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity ${open ? "opacity-100" : ""} ${isActive ? "text-primary opacity-100" : "text-muted-foreground"}`} />
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0 border-border" sideOffset={8}>
          {renderFilterContent()}
        </PopoverContent>
      </Popover>
    </TableHead>
  );
}

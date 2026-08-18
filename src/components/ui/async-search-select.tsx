"use client";

import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Search, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";

interface AsyncSearchSelectProps {
  tableName: string;
  displayColumn?: string;
  valueColumn?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  filterColumn?: string;
  filterValue?: any;
}

export function AsyncSearchSelect({
  tableName,
  displayColumn = "name",
  valueColumn = "id",
  value,
  onChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  className,
  disabled = false,
  filterColumn,
  filterValue,
}: AsyncSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedValueLabel, setSelectedValueLabel] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function fetchOptions() {
      setIsLoading(true);
      
      let query = supabase
        .from(tableName)
        .select(`${valueColumn}, ${displayColumn}`)
        .limit(50);

      if (filterColumn && filterValue !== undefined && filterValue !== null) {
        query = query.eq(filterColumn, filterValue);
      }

      if (search) {
        query = query.ilike(displayColumn, `%${search}%`);
      }

      const { data, error } = await query;

      // A bad table/column here (e.g. selecting `name` from a table whose label
      // column is `expense_name`) returns an error and an empty list, which the
      // UI renders as a bland "No results found." — indistinguishable from a
      // genuinely empty table. Log it so the next one is diagnosable.
      if (error) {
        console.error(
          `AsyncSearchSelect: query failed on "${tableName}" (select "${valueColumn}, ${displayColumn}")`,
          error
        );
      }

      if (!error && data) {
        setOptions(
          data.map((item: Record<string, any>) => ({
            label: item[displayColumn] || item['company'] || item['name'] || 'Unnamed',
            value: item[valueColumn],
          }))
        );
      }
      setIsLoading(false);
    }

    if (open) {
      fetchOptions();
    }
  }, [open, search, tableName, displayColumn, valueColumn]);

  // Fetch initial selected value label if we have a value but no options loaded yet
  useEffect(() => {
    async function fetchSelectedLabel() {
      if (value && !selectedValueLabel) {
        const { data } = await supabase
          .from(tableName)
          .select(displayColumn)
          .eq(valueColumn, value)
          .single();
          
        if (data) {
          setSelectedValueLabel((data as Record<string, any>)[displayColumn]);
        }
      }
    }
    fetchSelectedLabel();
  }, [value, tableName, displayColumn, valueColumn, selectedValueLabel]);

  // Update selected value label if options has it
  useEffect(() => {
    if (value && options.length > 0) {
      const match = options.find((o) => o.value === value);
      if (match) setSelectedValueLabel(match.label);
    } else if (!value) {
      setSelectedValueLabel(null);
    }
  }, [value, options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn("relative flex w-full items-center justify-between rounded-md bg-muted border border-border px-3 py-2 text-sm font-normal text-foreground hover:bg-muted outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
      >
        <div className="flex-1 truncate">
          {value 
            ? (selectedValueLabel || "Loading...") 
            : placeholder}
        </div>
        {value && (
          <div 
            role="button" 
            tabIndex={0}
            className="mr-2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-background cursor-pointer z-10"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onChange("");
              }
            }}
          >
            <X className="h-3 w-3" />
          </div>
        )}
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-popover border-border">
        <div className="flex items-center border-b border-border/50 px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="max-h-[300px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          ) : options.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <div className="p-1">
              {options.map((option) => (
                <div
                  key={option.value}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    value === option.value ? "bg-accent/50 text-accent-foreground" : "text-popover-foreground"
                  )}
                  onClick={() => {
                    onChange(option.value === value ? "" : option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

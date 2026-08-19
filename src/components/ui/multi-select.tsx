"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MultiSelectProps {
  options: { label: string; value: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /** Show a search box at the top of the dropdown to filter options. */
  searchable?: boolean;
}

export function MultiSelect({
  options,
  selectedValues = [],
  onChange,
  placeholder = "Select options...",
  emptyMessage = "No options found.",
  disabled = false,
  searchable = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((item) => item !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const removeOption = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedValues.filter((item) => item !== value));
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-10 h-auto font-normal text-left"
        >
          <div className="flex flex-wrap gap-1.5 items-center">
            {selectedValues.length === 0 ? (
              <span className="text-muted-foreground text-sm">{placeholder}</span>
            ) : (
              selectedValues.map((val) => {
                const option = options.find((o) => o.value === val);
                return (
                  <Badge
                    key={val}
                    variant="secondary"
                    className="text-xs py-0.5 px-2 gap-1 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {option?.label || val}
                    <div
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => removeOption(val, e)}
                    >
                      <X className="h-3 w-3 cursor-pointer hover:text-destructive" />
                    </div>
                  </Badge>
                );
              })
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0" align="start">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <ScrollArea className="max-h-[250px] overflow-y-auto p-2 space-y-1">
            {visibleOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2 text-center">{emptyMessage}</p>
            ) : (
              visibleOptions.map((option) => {
                const isSelected = selectedValues.includes(option.value);
                return (
                  <div
                    key={option.value}
                    onClick={() => toggleOption(option.value)}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-2 rounded-md text-sm cursor-pointer transition-colors",
                      isSelected ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted"
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                );
              })
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

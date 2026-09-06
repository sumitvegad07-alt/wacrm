"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Search, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SearchableSelectProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  /**
   * When provided, the dropdown offers "+ Create '<typed text>'" whenever the
   * typed text doesn't match an existing option. The handler creates the record
   * and returns the new option; it is then selected automatically. This is what
   * makes any lookup dropdown (lead source/industry/status, etc.) able to add a
   * new value inline instead of sending the user to Settings.
   */
  onCreateOption?: (label: string) => Promise<{ value: string; label: string } | null>;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  className,
  disabled = false,
  onCreateOption,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  const trimmed = search.trim();
  const exactExists = options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());
  const canCreate = !!onCreateOption && trimmed.length > 0 && !exactExists;

  const handleCreate = async () => {
    if (!onCreateOption || !trimmed || creating) return;
    setCreating(true);
    try {
      const created = await onCreateOption(trimmed);
      if (created) {
        onChange(created.value);
        setSearch("");
        setOpen(false);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn("flex w-full items-center justify-between rounded-md bg-muted border border-border px-3 py-2 text-sm font-normal text-foreground hover:bg-muted outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
      >
        <span className="truncate">
          {value
            ? options.find((option) => option.value === value)?.label || placeholder
            : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
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
          {filteredOptions.length === 0 && !canCreate ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <div className="p-1">
              {canCreate && (
                <div
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm font-medium text-primary outline-none hover:bg-accent"
                  onClick={handleCreate}
                >
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Create &ldquo;{trimmed}&rdquo;
                </div>
              )}
              {filteredOptions.map((option) => (
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

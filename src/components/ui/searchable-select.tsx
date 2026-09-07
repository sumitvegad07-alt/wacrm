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
   * When provided, the dropdown shows an always-visible "+ Create new …" footer.
   * Typing a value that doesn't exist turns it into Create "<typed>"; otherwise
   * clicking it reveals an inline input. The handler creates the record and
   * returns the new option, which is then selected — so any lookup dropdown
   * (lead source/industry/status, expense/payment type, …) can add a value
   * inline instead of sending the user to Settings.
   */
  onCreateOption?: (label: string) => Promise<{ value: string; label: string } | null>;
  /** Noun shown in the footer, e.g. "source" → "Create new source". */
  createLabel?: string;
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
  createLabel = "option",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [createText, setCreateText] = useState("");

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  const trimmed = search.trim();
  const exactExists = options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());
  const canCreateTyped = !!onCreateOption && trimmed.length > 0 && !exactExists;

  const doCreate = async (label: string) => {
    const name = label.trim();
    if (!onCreateOption || !name || creating) return;
    setCreating(true);
    try {
      const created = await onCreateOption(name);
      if (created) {
        onChange(created.value);
        setSearch("");
        setCreateText("");
        setCreateMode(false);
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
        <ScrollArea className="max-h-[280px] overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <div className="p-1">
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

        {/* Always-visible "Create new" footer — the discoverable way to add a value. */}
        {onCreateOption && (
          <div className="border-t border-border/60 p-1">
            {createMode ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  autoFocus
                  value={createText}
                  onChange={(e) => setCreateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doCreate(createText);
                    if (e.key === "Escape") setCreateMode(false);
                  }}
                  placeholder={`New ${createLabel} name`}
                  className="h-8 flex-1 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => doCreate(createText)}
                  disabled={creating || !createText.trim()}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </button>
                <button type="button" onClick={() => setCreateMode(false)} className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (canCreateTyped) doCreate(trimmed);
                  else {
                    setCreateText(trimmed);
                    setCreateMode(true);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium text-primary outline-none hover:bg-accent"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {canCreateTyped ? <>Create &ldquo;{trimmed}&rdquo;</> : <>Create new {createLabel}</>}
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

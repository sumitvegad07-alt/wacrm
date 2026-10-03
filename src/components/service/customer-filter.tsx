"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { searchCustomersAsUser, type CustomerOption } from "@/lib/service/assets/browser";
import { cn } from "@/lib/utils";

export type { CustomerOption };

interface CustomerFilterProps {
  value: CustomerOption | null;
  onChange: (next: CustomerOption | null) => void;
  className?: string;
}

/**
 * Customer picker for the asset list filter. It searches `contacts` by name OR phone because the
 * generic AsyncSearchSelect can only search one column and labels a customer with no name as
 * "Unnamed" — and real production customers imported from a phone list have no name.
 *
 * Queries run in the browser under the user's session, so contacts data scoping (RLS) applies:
 * a rep only finds customers they can see.
 */
export function CustomerFilter({ value, onChange, className }: CustomerFilterProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const found = await searchCustomersAsUser(term);
        if (!cancelled) setHits(found);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setHits([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, term ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTerm("");
      }}
    >
      <PopoverTrigger
        className={cn(
          "relative flex h-8 w-48 items-center justify-between gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-normal text-foreground outline-none hover:bg-muted focus:ring-1 focus:ring-primary",
          className,
        )}
      >
        <span className={cn("flex-1 truncate text-left", !value && "text-muted-foreground")}>
          {value ? value.label : "Customer"}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear customer filter"
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange(null);
              }
            }}
          >
            <X className="size-3" />
          </span>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 border-border bg-popover p-0">
        <div className="flex items-center border-b border-border/50 px-3">
          <Search className="mr-2 size-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name or phone"
            className="flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ScrollArea className="max-h-[280px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Searching...
            </div>
          ) : failed ? (
            <div className="py-6 text-center text-sm text-destructive">Could not search customers.</div>
          ) : hits.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No customers found.</div>
          ) : (
            <div className="p-1">
              {hits.map((c) => (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={value?.id === c.id}
                  className={cn(
                    "flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                    value?.id === c.id && "font-medium",
                  )}
                  onClick={() => {
                    onChange(value?.id === c.id ? null : c);
                    setOpen(false);
                    setTerm("");
                  }}
                >
                  <Check className={cn("mr-2 size-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.label}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

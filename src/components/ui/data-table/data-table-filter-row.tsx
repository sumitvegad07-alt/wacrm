"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Check, X, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableHead, TableRow } from "@/components/ui/table";
import { ColumnDef, ColumnOption, FilterState } from "./data-table-types";

/**
 * The filter row: a permanent second row under the headings, one cell per
 * column, showing what is filtered rather than hiding it behind a click.
 *
 * Filters used to live in a popover on the column heading, so nothing on
 * screen said a table was filtered except a tinted label. Here the applied
 * value is visible as text or as a chip, and clearing it is one click.
 *
 * It only reads and writes `filterState`. Turning those values into query
 * conditions still belongs to `lib/table/apply-filters.ts`, unchanged.
 */

const DATE_OPTIONS: ColumnOption[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last Week", value: "last_week" },
  { label: "Current month", value: "current_month" },
  { label: "Current quarter", value: "current_quarter" },
  { label: "Current financial year", value: "current_year" },
  { label: "Previous month", value: "previous_month" },
  { label: "Custom Range...", value: "custom" },
];

/** Anything the table treats as "no filter set". */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0 && value.some((v) => v !== "");
  return true;
}

/** The shared look of a cell that currently carries a filter. */
const chipClass =
  "inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary";

function ClearButton({ onClear, label }: { onClear: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${label} filter`}
      title={`Clear ${label} filter`}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className="shrink-0 rounded-sm p-0.5 text-current opacity-70 transition-opacity hover:opacity-100"
    >
      <X className="size-3" />
    </button>
  );
}

/**
 * Free-text filter, typed straight into the row.
 *
 * Debounced, and holding its own draft while it waits: on a server-paged
 * screen every keystroke would otherwise be a round-trip, and the re-render
 * from the response would fight the cursor.
 */
function TextFilterCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}) {
  const applied = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(applied);
  const committed = useRef(applied);

  // Follow the applied value when something else changes it — clearing all
  // filters, applying a saved view, leaving the screen and coming back.
  useEffect(() => {
    if (applied !== committed.current) {
      committed.current = applied;
      setDraft(applied);
    }
  }, [applied]);

  useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      onChange(column.id, draft);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, column.id, onChange]);

  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={column.label}
        aria-label={`Filter by ${column.label}`}
        className="h-11 w-full min-w-[7rem] rounded border-border bg-background pl-7 pr-7 text-xs md:h-7"
      />
      {draft !== "" && (
        <span className="absolute right-1">
          <ClearButton
            label={column.label}
            onClear={() => {
              setDraft("");
              committed.current = "";
              onChange(column.id, "");
            }}
          />
        </span>
      )}
    </div>
  );
}

/** Pick one or more values from a list. */
function SelectFilterCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const options = column.options ?? [];

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const summary =
    selected.length === 0 ? null : selected.length === 1 ? labelFor(selected[0]) : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Filter by ${column.label}`}
        className="flex h-11 w-full min-w-[7rem] items-center gap-1 rounded border border-border bg-background px-2 text-left text-xs outline-none transition-colors hover:bg-muted md:h-7"
      >
        {summary ? (
          <span className={chipClass}>
            <span className="truncate">{summary}</span>
          </span>
        ) : (
          <>
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{column.label}</span>
          </>
        )}
        <span className="ml-auto flex items-center">
          {summary ? (
            <ClearButton label={column.label} onClear={() => onChange(column.id, null)} />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" sideOffset={6}>
        <div className="mb-2 border-b border-border px-2 pb-2 text-sm font-medium">
          Filter by {column.label}
        </div>
        {options.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No values to choose from.</p>
        ) : (
          <div className="max-h-60 space-y-1 overflow-y-auto p-1">
            {options.map((opt) => {
              const isActive = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted"
                >
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...selected, opt.value]
                        : selected.filter((v) => v !== opt.value);
                      onChange(column.id, next.length > 0 ? next : null);
                    }}
                    className="size-4"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-border px-1 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(column.id, null);
              setOpen(false);
            }}
            className="h-11 text-xs text-muted-foreground md:h-7"
          >
            Clear
          </Button>
          <Button size="sm" className="h-11 text-xs md:h-7" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Date presets, or a custom range. */
function DateFilterCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const isCustom = Array.isArray(value) || value === "custom";
  const customStart = Array.isArray(value) ? (value[0] as string) : "";
  const customEnd = Array.isArray(value) ? (value[1] as string) : "";

  let summary: string | null = null;
  if (Array.isArray(value) && (customStart || customEnd)) {
    summary = `${customStart || "…"} → ${customEnd || "…"}`;
  } else if (typeof value === "string" && value !== "" && value !== "custom") {
    summary = DATE_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Filter by ${column.label}`}
        className="flex h-11 w-full min-w-[7rem] items-center gap-1 rounded border border-border bg-background px-2 text-left text-xs outline-none transition-colors hover:bg-muted md:h-7"
      >
        {summary ? (
          <span className={chipClass}>
            <span className="truncate">{summary}</span>
          </span>
        ) : (
          <>
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{column.label}</span>
          </>
        )}
        <span className="ml-auto flex items-center">
          {summary ? (
            <ClearButton label={column.label} onClear={() => onChange(column.id, null)} />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2" sideOffset={6}>
        {!isCustom ? (
          <div className="space-y-1">
            {DATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-left text-sm ${
                  value === opt.value ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"
                }`}
                onClick={() => {
                  if (opt.value === "custom") {
                    onChange(column.id, ["", ""]);
                  } else {
                    onChange(column.id, value === opt.value ? null : opt.value);
                    setOpen(false);
                  }
                }}
              >
                {opt.label}
                {value === opt.value && <Check className="size-4" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 p-2">
            <div className="border-b border-border pb-2 text-sm font-medium">Custom Date Range</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start Date</label>
                <Input
                  type="date"
                  className="h-11 md:h-8"
                  value={customStart}
                  onChange={(e) => onChange(column.id, [e.target.value, customEnd])}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">End Date</label>
                <Input
                  type="date"
                  className="h-11 md:h-8"
                  value={customEnd}
                  onChange={(e) => onChange(column.id, [customStart, e.target.value])}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(column.id, null)}
                className="h-11 text-xs text-muted-foreground md:h-7"
              >
                Cancel
              </Button>
              <Button size="sm" className="h-11 text-xs md:h-7" onClick={() => setOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function DataTableFilterRow<T>({
  columns,
  filterState,
  onFilterChange,
  leadingColSpan,
}: {
  columns: ColumnDef<T>[];
  filterState: FilterState;
  onFilterChange: (id: string, value: unknown) => void;
  /** Selection checkbox + pinned Action column, so the row stays aligned. */
  leadingColSpan: number;
}) {
  // A table with nothing filterable gets no row at all, rather than an empty
  // band of grey above the data.
  if (!columns.some((c) => c.type)) return null;

  return (
    // Tinted so the filters read as a band of controls rather than a second
    // row of data, and never highlighted on hover like a data row.
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      {Array.from({ length: leadingColSpan }, (_, i) => (
        <TableHead key={`lead-${i}`} className="p-1" />
      ))}
      {columns.map((column) => (
        <TableHead key={column.id} className="p-1 align-middle font-normal">
          {column.type === "text" && (
            <TextFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
          {column.type === "select" && (
            <SelectFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
          {column.type === "date" && (
            <DateFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
        </TableHead>
      ))}
    </TableRow>
  );
}

export { isSet as isFilterValueSet };

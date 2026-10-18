'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Check, X, ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableHead, TableRow } from '@/components/ui/table';
import { useColumnFilterOptions } from '@/hooks/use-column-filter-options';
import { cn } from '@/lib/utils';
import { ColumnDef, ColumnOption, FilterState } from './data-table-types';

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
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'Current month', value: 'current_month' },
  { label: 'Current quarter', value: 'current_quarter' },
  { label: 'Current financial year', value: 'current_year' },
  { label: 'Previous month', value: 'previous_month' },
  { label: 'Custom Range...', value: 'custom' },
];

/** Anything the table treats as "no filter set". */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value))
    return value.length > 0 && value.some((v) => v !== '');
  return true;
}

/** The shared look of a cell that currently carries a filter. */
const chipClass =
  'inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary';

function ClearButton({
  onClear,
  label,
}: {
  onClear: () => void;
  label: string;
}) {
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
  const applied = typeof value === 'string' ? value : '';
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
      <Search className="text-muted-foreground pointer-events-none absolute left-2 size-3.5" />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={column.label}
        aria-label={`Filter by ${column.label}`}
        className="border-border bg-background h-11 w-full min-w-[7rem] rounded pr-7 pl-7 text-xs md:h-7"
      />
      {draft !== '' && (
        <span className="absolute right-1">
          <ClearButton
            label={column.label}
            onClear={() => {
              setDraft('');
              committed.current = '';
              onChange(column.id, '');
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
  const { options, loading, error, truncated, search, setSearch } =
    useColumnFilterOptions(column, open);

  /**
   * The chip has to name a chosen value even before the list has loaded, and
   * for a value no longer in the list. Fall back to the raw value rather than
   * showing a blank chip.
   */
  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;
  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? labelFor(selected[0])
        : `${selected.length} selected`;

  return (
    <div className="relative flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Filter by ${column.label}`}
          className="border-border bg-background hover:bg-muted flex h-11 w-full min-w-[7rem] items-center gap-1 rounded border pr-7 pl-2 text-left text-xs transition-colors outline-none md:h-7"
        >
          {summary ? (
            <span className={chipClass}>
              <span className="truncate">{summary}</span>
            </span>
          ) : (
            <>
              <Search className="text-muted-foreground size-3.5 shrink-0" />
              <span className="text-muted-foreground truncate">
                {column.label}
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2" sideOffset={6}>
          <div className="border-border mb-2 border-b px-2 pb-2 text-sm font-medium">
            Filter by {column.label}
          </div>
          {/* The search box appears once the list is long enough to be worth
            searching, or when more values exist than came back — so the long
            tail is always reachable by typing. It stays once the user has
            typed, even if their search narrowed the list below the threshold. */}
          {(truncated || search !== '' || options.length > 8) && (
            <div className="relative mb-2 flex items-center px-1">
              <Search className="text-muted-foreground pointer-events-none absolute left-3 size-3.5" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${column.label}...`}
                className="h-11 pl-7 text-xs md:h-8"
                autoFocus
              />
            </div>
          )}
          {loading ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              Loading values…
            </p>
          ) : error ? (
            <p className="text-destructive px-2 py-3 text-xs">{error}</p>
          ) : options.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              No values to choose from.
            </p>
          ) : (
            <div className="max-h-60 space-y-1 overflow-y-auto p-1">
              {options.map((opt) => {
                const isActive = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5"
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
          <div className="border-border mt-2 flex items-center justify-between border-t px-1 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(column.id, null);
                setOpen(false);
              }}
              className="text-muted-foreground h-11 text-xs md:h-7"
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="h-11 text-xs md:h-7"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span className="pointer-events-none absolute right-1 flex items-center">
        {summary ? (
          <span className="pointer-events-auto">
            <ClearButton
              label={column.label}
              onClear={() => onChange(column.id, null)}
            />
          </span>
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
      </span>
    </div>
  );
}

/** Date presets, or a custom range. */
/**
 * A from/to pair, for amounts.
 *
 * Money columns used to carry no filter at all, because a contains match on an
 * amount misleads: searching 100 matches 1,100. Either end may be left blank,
 * so "over 10,000" and "under 500" are both expressible.
 */
function RangeFilterCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [min, max] = Array.isArray(value)
    ? [String(value[0] ?? ''), String(value[1] ?? '')]
    : ['', ''];

  const commit = (nextMin: string, nextMax: string) =>
    onChange(column.id, nextMin === '' && nextMax === '' ? null : [nextMin, nextMax]);

  let summary: string | null = null;
  if (min !== '' && max !== '') summary = `${min} – ${max}`;
  else if (min !== '') summary = `≥ ${min}`;
  else if (max !== '') summary = `≤ ${max}`;

  return (
    <div className="relative flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Filter by ${column.label}`}
          className="border-border bg-background hover:bg-muted flex h-11 w-full min-w-[7rem] items-center gap-1 rounded border pr-7 pl-2 text-left text-xs transition-colors outline-none md:h-7"
        >
          {summary ? (
            <span className={chipClass}>
              <span className="truncate">{summary}</span>
            </span>
          ) : (
            <>
              <Search className="text-muted-foreground size-3.5 shrink-0" />
              <span className="text-muted-foreground truncate">{column.label}</span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3" sideOffset={6}>
          <div className="border-border mb-3 border-b pb-2 text-sm font-medium">
            Filter by {column.label}
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs" htmlFor={`${column.id}-from`}>
                From
              </label>
              <Input
                id={`${column.id}-from`}
                aria-label={`${column.label} from`}
                type="number"
                inputMode="decimal"
                className="h-11 text-xs md:h-8"
                value={min}
                placeholder="Any"
                onChange={(e) => commit(e.target.value, max)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs" htmlFor={`${column.id}-to`}>
                To
              </label>
              <Input
                id={`${column.id}-to`}
                aria-label={`${column.label} to`}
                type="number"
                inputMode="decimal"
                className="h-11 text-xs md:h-8"
                value={max}
                placeholder="Any"
                onChange={(e) => commit(min, e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(column.id, null);
                setOpen(false);
              }}
              className="text-muted-foreground h-11 text-xs md:h-7"
            >
              Clear
            </Button>
            <Button size="sm" className="h-11 text-xs md:h-7" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span className="pointer-events-none absolute right-1 flex items-center">
        {summary ? (
          <span className="pointer-events-auto">
            <ClearButton label={column.label} onClear={() => onChange(column.id, null)} />
          </span>
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
      </span>
    </div>
  );
}


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
  const isCustom = Array.isArray(value) || value === 'custom';
  const customStart = Array.isArray(value) ? (value[0] as string) : '';
  const customEnd = Array.isArray(value) ? (value[1] as string) : '';

  let summary: string | null = null;
  if (Array.isArray(value) && (customStart || customEnd)) {
    summary = `${customStart || '…'} → ${customEnd || '…'}`;
  } else if (typeof value === 'string' && value !== '' && value !== 'custom') {
    summary = DATE_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  return (
    <div className="relative flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Filter by ${column.label}`}
          className="border-border bg-background hover:bg-muted flex h-11 w-full min-w-[7rem] items-center gap-1 rounded border pr-7 pl-2 text-left text-xs transition-colors outline-none md:h-7"
        >
          {summary ? (
            <span className={chipClass}>
              <span className="truncate">{summary}</span>
            </span>
          ) : (
            <>
              <Search className="text-muted-foreground size-3.5 shrink-0" />
              <span className="text-muted-foreground truncate">
                {column.label}
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2" sideOffset={6}>
          {!isCustom ? (
            <div className="space-y-1">
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-left text-sm ${
                    value === opt.value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => {
                    if (opt.value === 'custom') {
                      onChange(column.id, ['', '']);
                    } else {
                      onChange(
                        column.id,
                        value === opt.value ? null : opt.value
                      );
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
              <div className="border-border border-b pb-2 text-sm font-medium">
                Custom Date Range
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-muted-foreground text-xs" htmlFor={`${column.id}-start`}>
                    Start Date
                  </label>
                  <Input
                    id={`${column.id}-start`}
                    aria-label={`${column.label} start date`}
                    type="date"
                    className="h-11 md:h-8"
                    value={customStart}
                    onChange={(e) =>
                      onChange(column.id, [e.target.value, customEnd])
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-muted-foreground text-xs" htmlFor={`${column.id}-end`}>
                    End Date
                  </label>
                  <Input
                    id={`${column.id}-end`}
                    aria-label={`${column.label} end date`}
                    type="date"
                    className="h-11 md:h-8"
                    value={customEnd}
                    onChange={(e) =>
                      onChange(column.id, [customStart, e.target.value])
                    }
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(column.id, null)}
                  className="text-muted-foreground h-11 text-xs md:h-7"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-11 text-xs md:h-7"
                  onClick={() => setOpen(false)}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <span className="pointer-events-none absolute right-1 flex items-center">
        {summary ? (
          <span className="pointer-events-auto">
            <ClearButton
              label={column.label}
              onClear={() => onChange(column.id, null)}
            />
          </span>
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
      </span>
    </div>
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
        <TableHead
          key={column.id}
          className={cn('p-1 align-middle font-normal', column.cellClassName)}
        >
          {column.type === 'text' && (
            <TextFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
          {column.type === 'select' && (
            <SelectFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
          {column.type === 'range' && (
            <RangeFilterCell
              column={column as ColumnDef<unknown>}
              value={filterState[column.id]}
              onChange={onFilterChange}
            />
          )}
          {column.type === 'date' && (
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

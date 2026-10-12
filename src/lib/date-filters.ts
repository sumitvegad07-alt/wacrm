export function isDateInFilter(dateString: string | Date | null | undefined, filterValue: string | string[]): boolean {
  if (!dateString) return false;
  
  const targetDate = new Date(dateString);
  if (isNaN(targetDate.getTime())) return false;
  
  const now = new Date();
  
  if (Array.isArray(filterValue)) {
    // Custom range: [startDate, endDate]
    const start = filterValue[0] ? new Date(filterValue[0]) : null;
    const end = filterValue[1] ? new Date(filterValue[1]) : null;
    
    if (end) end.setHours(23, 59, 59, 999);
    
    if (start && targetDate < start) return false;
    if (end && targetDate > end) return false;
    return true;
  }
  
  if (filterValue === "today") {
    return targetDate.toDateString() === now.toDateString();
  }
  
  if (filterValue === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return targetDate.toDateString() === yesterday.toDateString();
  }
  
  if (filterValue === "last_week") {
    // Last week (last 7 days, excluding today? Or previous week?)
    // Let's implement as "within the last 7 days"
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    lastWeek.setHours(0, 0, 0, 0);
    return targetDate >= lastWeek && targetDate <= now;
  }
  
  if (filterValue === "current_month") {
    return targetDate.getMonth() === now.getMonth() && targetDate.getFullYear() === now.getFullYear();
  }
  
  if (filterValue === "previous_month") {
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return targetDate.getMonth() === prevMonth.getMonth() && targetDate.getFullYear() === prevMonth.getFullYear();
  }
  
  if (filterValue === "current_quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetQuarter = Math.floor(targetDate.getMonth() / 3);
    return targetQuarter === currentQuarter && targetDate.getFullYear() === now.getFullYear();
  }
  
  if (filterValue === "current_year") {
    return targetDate.getFullYear() === now.getFullYear();
  }

  return true;
}

/**
 * The same presets as `isDateInFilter`, expressed as a half-open calendar range
 * so the filter can be pushed into the query instead of applied to rows the
 * browser has already downloaded.
 *
 * Deliberately built from the BROWSER's local calendar, exactly like
 * `isDateInFilter` above. Moving these screens to server-side filtering should
 * not quietly change which rows a preset selects; converting the whole app's
 * date handling to account-local is a separate, deliberate change.
 *
 * Returns ISO `YYYY-MM-DD` bounds, both inclusive, for a `date` column.
 * `null` means the preset puts no bound on that end; an empty object means the
 * value selects everything (matching `isDateInFilter`'s `return true` default).
 */
export function dateFilterToRange(
  filterValue: string | string[] | null | undefined,
): { gte?: string; lte?: string } {
  if (!filterValue) return {};

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (Array.isArray(filterValue)) {
    const [start, end] = filterValue;
    const range: { gte?: string; lte?: string } = {};
    if (start) range.gte = iso(new Date(start));
    if (end) range.lte = iso(new Date(end));
    return range;
  }

  const now = new Date();
  const dayStart = (offsetDays: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return d;
  };

  switch (filterValue) {
    case "today":
      return { gte: iso(now), lte: iso(now) };
    case "yesterday": {
      const y = dayStart(-1);
      return { gte: iso(y), lte: iso(y) };
    }
    case "last_week":
      // "within the last 7 days", matching isDateInFilter's comment and code.
      return { gte: iso(dayStart(-7)), lte: iso(now) };
    case "current_month":
      return {
        gte: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        lte: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "previous_month":
      return {
        gte: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        lte: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "current_quarter": {
      const firstMonth = Math.floor(now.getMonth() / 3) * 3;
      return {
        gte: iso(new Date(now.getFullYear(), firstMonth, 1)),
        lte: iso(new Date(now.getFullYear(), firstMonth + 3, 0)),
      };
    }
    case "current_year":
      return {
        gte: iso(new Date(now.getFullYear(), 0, 1)),
        lte: iso(new Date(now.getFullYear(), 11, 31)),
      };
    default:
      // isDateInFilter returns true for anything it does not recognise.
      return {};
  }
}

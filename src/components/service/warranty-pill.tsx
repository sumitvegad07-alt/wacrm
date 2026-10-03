import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { EXPIRING_WINDOW_DAYS, type warrantyState } from '@/lib/service/settings';

/** Exactly what `warrantyState()` returns, so a new state there is a compile error here. */
export type WarrantyPillState = ReturnType<typeof warrantyState>;

export interface WarrantyPillProps {
  /** From `warrantyState(asset, today)` — the single source of truth for the colour. Never re-derive it. */
  state: WarrantyPillState;
  /** `warranty_end`, a `YYYY-MM-DD` date (or null). Shown in the pill. */
  endDate: string | null;
  className?: string;
}

// warranty_end is a DATE with no zone. Format it as the UTC calendar day it names (the same anchoring
// warrantyState uses), so a viewer west of UTC never sees "4 Oct" for a warranty ending on 5 Oct.
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatEnd(endDate: string | null): string | null {
  if (!endDate) return null;
  const ms = Date.parse(`${endDate}T00:00:00Z`);
  return Number.isNaN(ms) ? endDate : DATE_FORMAT.format(ms);
}

/**
 * Warranty status pill: neutral for none and active, amber for expiring, red for expired.
 * The colour is never the only signal: expiring and expired also say so in words.
 * Reused by the asset detail screen and the customer's asset panel.
 */
export function WarrantyPill({ state, endDate, className }: WarrantyPillProps) {
  const date = formatEnd(endDate);

  if (state === 'none' || !date) {
    return (
      <Badge variant="neutral" className={className} title="No warranty end date recorded">
        No warranty
      </Badge>
    );
  }

  if (state === 'expired') {
    return (
      <Badge variant="destructive" className={className} title="Warranty has ended">
        Expired {date}
      </Badge>
    );
  }

  if (state === 'expiring') {
    return (
      <Badge
        variant="warning"
        // text-warning is too pale on the tinted pill in light mode; darken it, keep the tint.
        className={cn('text-amber-800 dark:text-amber-300', className)}
        title={`Warranty ends within ${EXPIRING_WINDOW_DAYS} days`}
      >
        Expires {date}
      </Badge>
    );
  }

  return (
    <Badge variant="neutral" className={className} title="Under warranty">
      {date}
    </Badge>
  );
}

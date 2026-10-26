/**
 * WACRM / OZZO CRM — status vocabulary.
 *
 * ## This file is NOT the design system
 *
 * It used to be: a 215-line `tokens` object covering spacing, typography,
 * radius, z-index, layout dimensions, button heights, dialog and drawer sizes.
 * In the whole app it was imported exactly once, and only for
 * `STATUS_MAPPINGS` below. Everything else had no consumer at all, and having
 * never been read it had quietly drifted away from what ships — it claimed a
 * 16rem sidebar (it is 13rem), a 3rem table row (it is 2rem), 1.5rem of page
 * padding (it is 1rem) and a 6px `md` radius (it is 8px). Anyone who had
 * started using it would have produced new inconsistency, not less.
 *
 * The real tokens live in `src/app/globals.css`, in the `@theme inline` block,
 * because that is the only place Tailwind can turn them into utilities and the
 * only place the browser actually reads. Add a token there:
 *
 *   control heights   --spacing-control{,-sm,-lg,-touch}  -> h-control, …
 *   type scale        --text-{micro,caption,table,label,body,section,page-title}
 *   stacking order    --z-index-{dropdown,sticky,overlay,modal,popover,tooltip,toast}
 *   layout dimensions --layout-{header-h,sidebar-w,page-gutter,row-h,grid-min-h}
 *   colour + radius   --primary*, --success/--warning/--info, --radius*
 *
 * Do not reintroduce a TypeScript mirror of those. A second source of truth is
 * what produced the drift the first time.
 *
 * What stays here is the one thing that genuinely belongs in TypeScript: the
 * mapping from a status string the database stores to a semantic variant the
 * UI paints. That is data, not styling.
 *
 * @module src/lib/design-tokens
 */

/**
 * Valid badge/status variants in the CRM design system.
 */
export type StatusVariant =
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'neutral'
  | 'default'
  | 'secondary'
  | 'outline';

/**
 * Maps logical data statuses to semantic UI variants.
 * Feeds directly into CVA badge/status indicator props — see
 * `src/components/shared/status-badge.tsx`, the only consumer.
 */
export const STATUS_MAPPINGS: Record<string, StatusVariant> = {
  // Positive / Success
  active: 'success',
  completed: 'success',
  approved: 'success',
  delivered: 'success',
  paid: 'success',
  converted: 'success',
  won: 'success',
  // An order reaches Closed when it is fully dispatched and booked — a completed
  // outcome. It previously shared the destructive treatment with Cancelled, which made
  // a healthy order list unreadable at a glance.
  closed: 'success',
  open: 'success',
  dispatched: 'success',

  // Warning / Attention
  pending: 'warning',
  pending_approval: 'warning',
  'pending approval': 'warning',
  processing: 'warning',
  review: 'warning',
  paused: 'warning',
  awaiting: 'warning',
  scheduled: 'warning',
  medium: 'warning',
  stale: 'warning',

  // Destructive / Critical
  error: 'destructive',
  failed: 'destructive',
  rejected: 'destructive',
  cancelled: 'destructive',
  overdue: 'destructive',
  expired: 'destructive',
  lost: 'destructive',
  high: 'destructive',
  urgent: 'destructive',

  // Info
  in_progress: 'info',
  assigned: 'info',
  sent: 'info',
  part_dispatch: 'info',
  'part dispatch': 'info',
  low: 'info',
  sending: 'info',
  queued: 'info',

  // Neutral / Passive
  draft: 'neutral',
  inactive: 'neutral',
  archived: 'neutral',
  unassigned: 'neutral',
  offline: 'neutral',
};

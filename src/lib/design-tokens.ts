/**
 * WACRM / OZZO CRM Design Tokens
 * Source of truth for layout, typography, animation, and component constraints.
 *
 * @module src/lib/design-tokens
 */

export const tokens = {
  spacing: {
    1: '0.25rem',    // 4px
    2: '0.5rem',     // 8px
    3: '0.75rem',    // 12px
    4: '1rem',       // 16px
    5: '1.25rem',    // 20px
    6: '1.5rem',     // 24px
    8: '2rem',       // 32px
    10: '2.5rem',    // 40px
    12: '3rem',      // 48px
  },

  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    '2xl': '16px',
    full: '9999px',
  },

  typography: {
    pageTitle: { size: '1.5rem', weight: 700, lineHeight: 1.2 },
    sectionTitle: { size: '1.125rem', weight: 600, lineHeight: 1.3 },
    tableHeader: { size: '0.75rem', weight: 600, transform: 'uppercase', letterSpacing: '0.05em' },
    body: { size: '0.875rem', weight: 400, lineHeight: 1.5 },
    caption: { size: '0.75rem', weight: 400 },
    helper: { size: '0.6875rem', weight: 400 },
    button: { size: '0.875rem', weight: 500 },
    badge: { size: '0.75rem', weight: 500 },
  },

  animation: {
    hover: '120ms',
    dropdown: '180ms',
    modal: '100ms',
    drawer: '200ms',
    tooltip: '100ms',
    accordion: '180ms',
    page: '200ms',
    skeleton: '1.5s',
    maxAllowed: '300ms',
  },

  breakpoints: {
    mobile: '768px',
    tablet: '1024px',
    desktop: '1280px',
    wide: '1440px',
  },

  zIndex: {
    base: 0,
    dropdown: 10,
    sticky: 20,
    overlay: 30,
    modal: 40,
    popover: 50,
    tooltip: 60,
    toast: 70,
  },

  layout: {
    pageMaxWidth: '1440px',
    pagePadding: '1.5rem',
    headerHeight: '3.5rem',
    sidebarWidth: '16rem',
    sidebarCollapsedWidth: '4rem',
    toolbarHeight: '3rem',
    tableHeaderHeight: '2.5rem',
    tableRowHeight: '3rem',
    tableRowCompactHeight: '2.25rem',
    tableRowExpandedHeight: '3.5rem',
    tableCheckboxWidth: '3rem',
    tableActionWidth: '7.5rem',
  },

  button: {
    heights: { xs: '1.5rem', sm: '1.75rem', default: '2rem', lg: '2.25rem' },
    iconSizes: { xs: '1.5rem', sm: '1.75rem', default: '2rem', lg: '2.25rem' },
  },

  avatar: {
    sizes: { xs: '1.5rem', sm: '2rem', default: '2.5rem', lg: '3rem', xl: '4rem' },
  },

  icon: {
    sizes: { xs: '0.75rem', sm: '0.875rem', default: '1rem', lg: '1.25rem', xl: '1.5rem', '2xl': '2.5rem' },
  },
} as const;

/**
 * Standardized Dialog sizes.
 * Use these constants instead of inline width styles.
 */
export const DIALOG_SIZES = {
  sm: '400px',
  md: '600px',
  lg: '800px',
  xl: '1000px',
  full: 'calc(100vw - 2rem)', // Leaves a 1rem margin on all sides
} as const;

export type DialogSize = keyof typeof DIALOG_SIZES;

/**
 * Standardized Drawer sizes.
 */
export const DRAWER_SIZES = {
  sm: '320px',
  md: '480px',
  lg: '640px',
  full: '100vw',
} as const;

export type DrawerSize = keyof typeof DRAWER_SIZES;

/**
 * Toast duration presets in milliseconds.
 */
export const TOAST_DURATIONS = {
  default: 4000,
  success: 3000,
  error: 6000,
  actionRequired: 10000,
  infinite: 0, // Requires manual dismissal
} as const;

/**
 * Valid badge/status variants in the CRM design system.
 */
export type StatusVariant = 'success' | 'warning' | 'destructive' | 'info' | 'neutral' | 'default' | 'secondary' | 'outline';

/**
 * Maps logical data statuses to semantic UI variants.
 * Feeds directly into CVA badge/status indicator props.
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

/**
 * Enforces a standard order for standard action buttons across the CRM.
 * Use to dynamically sort arrays of actions in toolbars or table rows.
 */
export const ACTION_ORDER = {
  view: 1,
  edit: 2,
  approve: 3,
  duplicate: 4,
  export: 5,
  archive: 6,
  delete: 7,
} as const;

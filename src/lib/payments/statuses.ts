export const PAYMENT_STATUSES = [
  'Pending',
  'Approved',
  'Rejected',
  'Cancelled',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Approved: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
  Cancelled: 'bg-slate-600 text-white shadow-sm border-transparent',
};

/**
 * Mirrors payment_status_transition_allowed() in the database, which is the real
 * enforcement point — the mobile app writes the table directly and never sees this.
 *
 * Approved is not fully terminal: a payment approved in error, or a cheque that
 * bounces afterwards, has to be reversible or the customer's outstanding balance
 * stays permanently wrong. Cancellation is that single audited exit, and it requires
 * a reason. Approved -> Pending and Approved -> Rejected remain forbidden.
 * Rejected and Cancelled are terminal.
 */
export const PAYMENT_STATUS_TRANSITIONS: Record<string, readonly PaymentStatus[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Cancelled'],
};

/** Statuses whose transition to Cancelled must carry a reason. */
export function requiresCancellationReason(nextStatus: string): boolean {
  return nextStatus === 'Cancelled';
}

/**
 * Client-side mirror of the database's cancellation guard, so the form can refuse
 * before a round trip. The database check remains authoritative.
 */
export function validateCancellation(reason: string | null | undefined): string | null {
  if (!reason || reason.trim() === '') return 'Cancellation reason is required';
  return null;
}

export const PAYMENT_SOURCES = ['visit', 'customer', 'admin', 'import', 'api'] as const;

export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  visit: 'Site Visit',
  customer: 'Customer App',
  admin: 'Admin Console',
  import: 'Data Import',
  api: 'API',
};

export function canTransitionTo(currentStatus: string, nextStatus: PaymentStatus): boolean {
  if (!PAYMENT_STATUS_TRANSITIONS[currentStatus]) return false;
  return PAYMENT_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function getStatusColor(status: string): string {
  return PAYMENT_STATUS_COLORS[status] || 'bg-gray-100 text-gray-800';
}

export function getSourceLabel(source: string): string {
  return PAYMENT_SOURCE_LABELS[source] || source;
}

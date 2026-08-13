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

export const PAYMENT_STATUS_TRANSITIONS: Record<string, readonly PaymentStatus[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  // Approved, Rejected, Cancelled are terminal states — no further transitions allowed
};

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

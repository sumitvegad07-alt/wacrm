/**
 * Customer financial maths for the Payment Collection module.
 *
 * Extracted from the UI so the rules that decide how much a customer owes — and
 * whether they are over their limit — can be tested directly instead of only being
 * exercised by clicking through the app.
 *
 * Outstanding = opening balance + billable orders - approved payments.
 *
 * Which orders are "billable" and which payments count is the account's own rule
 * since 2026-10-05 — see `outstanding-config`.
 */

import {
  DEFAULT_OUTSTANDING_CONFIG,
  readOutstandingConfig,
  type OutstandingConfig,
} from './outstanding-config';

export interface FinancialOrder {
  total_amount: number;
  /** Order date used for ageing. */
  created_at: string;
}

export interface FinancialPayment {
  amount: number;
  /** Set when an approver corrected the collected figure; wins over `amount`. */
  verified_amount?: number | null;
}

export interface CustomerFinancialInput {
  openingBalance?: number | null;
  creditLimit?: number | null;
  creditDays?: number | null;
  orders: FinancialOrder[];
  payments: FinancialPayment[];
  /** Server clock, so ageing never depends on the device's timezone or drift. */
  now: number;
}

export interface CustomerFinancials {
  totalOrders: number;
  approvedPayments: number;
  openingBalance: number;
  outstandingBalance: number;
  creditLimit: number | null;
  /** Null only when the customer genuinely has no limit configured. */
  availableCredit: number | null;
  creditDays: number | null;
  isOverdue: boolean;
  overdueDays: number;
}

/** Money arrives from Postgres NUMERIC as strings often enough to be worth coercing. */
function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The amount a payment settles. An approver may verify a different figure than the
 * rep collected (short cash, a bounced cheque part-honoured); the verified figure is
 * authoritative once present. `null` means "not yet verified", not "zero".
 */
export function settledAmount(payment: FinancialPayment): number {
  return payment.verified_amount === null || payment.verified_amount === undefined
    ? toNumber(payment.amount)
    : toNumber(payment.verified_amount);
}

export function computeCustomerFinancials(input: CustomerFinancialInput): CustomerFinancials {
  const openingBalance = toNumber(input.openingBalance);
  const totalOrders = input.orders.reduce((sum, o) => sum + toNumber(o.total_amount), 0);
  const approvedPayments = input.payments.reduce((sum, p) => sum + settledAmount(p), 0);

  const outstandingBalance = totalOrders - approvedPayments + openingBalance;

  // A configured limit of 0 is a real business rule (cash-only customer), so it must not
  // collapse to "unlimited" the way a truthiness check would.
  const creditLimit =
    input.creditLimit === null || input.creditLimit === undefined
      ? null
      : toNumber(input.creditLimit);
  const availableCredit = creditLimit === null ? null : creditLimit - outstandingBalance;

  const creditDays =
    input.creditDays === null || input.creditDays === undefined ? null : toNumber(input.creditDays);

  let isOverdue = false;
  let overdueDays = 0;

  if (creditDays !== null) {
    // Payments settle oldest debt first (FIFO): opening balance, then orders by date.
    // Whatever is left unpaid is aged against the customer's credit days.
    let unapplied = approvedPayments;

    if (unapplied >= openingBalance) {
      unapplied -= openingBalance;
    } else {
      unapplied = 0;
    }

    const aged = [...input.orders].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    for (const order of aged) {
      const amount = toNumber(order.total_amount);
      if (unapplied >= amount) {
        unapplied -= amount;
        continue;
      }
      unapplied = 0;
      const daysOld = Math.floor((input.now - new Date(order.created_at).getTime()) / 86_400_000);
      if (daysOld > creditDays) {
        isOverdue = true;
        overdueDays = Math.max(overdueDays, daysOld - creditDays);
      }
    }
  }

  return {
    totalOrders,
    approvedPayments,
    openingBalance,
    outstandingBalance,
    creditLimit,
    availableCredit,
    creditDays,
    isOverdue,
    overdueDays,
  };
}

/**
 * Structurally typed so these helpers work with the browser and server Supabase
 * clients alike without dragging the generated DB types through the signatures.
 */
type Db = {
  from: (t: string) => any;
  rpc: (fn: string) => any;
};

/**
 * The account's outstanding rule — which order statuses count as owed and which
 * payment statuses count as received.
 *
 * Any failure falls back to the pre-2026-10-05 behaviour rather than throwing or
 * counting nothing. A member whose RLS hides `accounts`, or a transient error,
 * must never be shown a zero balance for a customer who owes money.
 */
export async function fetchOutstandingConfig(
  db: Db,
  accountId: string
): Promise<OutstandingConfig> {
  const res = await db.from('accounts').select('settings').eq('id', accountId).single();
  if (!res?.data) return DEFAULT_OUTSTANDING_CONFIG;
  return readOutstandingConfig(res.data.settings);
}

/**
 * Load a customer's financial position from the database and compute it.
 *
 * This is the ONE place the outstanding figure is derived for the UI. Before this
 * existed, the payment form carried its own copy of the query and filtered orders by
 * `status = 'Approved'` instead of `'Closed'` — so a closed order was invisible and the
 * form told collectors a customer owed far less than they did. Anything that needs to
 * show what a customer owes must call this rather than re-deriving it.
 *
 * The business rule:
 *   Outstanding = opening balance + counted orders - counted payments
 *
 * Which statuses are "counted" is the account's choice (see `outstanding-config`).
 * `config` is deliberately REQUIRED rather than defaulted: a caller that forgets it
 * would otherwise silently report a different balance than the rest of the app, and
 * that is exactly the class of bug BUG-01 was. Callers without an account's settings
 * to hand get them from `fetchOutstandingConfig`.
 */
export async function fetchCustomerFinancials(
  db: Db,
  contactId: string,
  config: OutstandingConfig
): Promise<CustomerFinancials> {
  const [contactRes, ordersRes, paymentsRes, timeRes] = await Promise.all([
    db.from('contacts').select('credit_limit, credit_days, opening_balance').eq('id', contactId).single(),
    db.from('orders').select('total_amount, created_at').eq('contact_id', contactId).in('status', config.orderStatuses),
    db.from('payments').select('amount, verified_amount').eq('contact_id', contactId).in('status', config.paymentStatuses),
    db.rpc('get_server_time'),
  ]);

  const contact = contactRes?.data ?? {};
  // Server clock, so ageing never depends on the device's timezone or drift.
  const now = timeRes?.data ? new Date(timeRes.data as string).getTime() : Date.now();

  return computeCustomerFinancials({
    openingBalance: contact.opening_balance,
    creditLimit: contact.credit_limit,
    creditDays: contact.credit_days,
    orders: ordersRes?.data ?? [],
    payments: paymentsRes?.data ?? [],
    now,
  });
}

/**
 * Whether a new order of `orderValue` would breach the customer's limit.
 * No configured limit means no ceiling to breach.
 */
export function exceedsCreditLimit(
  financials: Pick<CustomerFinancials, 'creditLimit' | 'outstandingBalance'>,
  orderValue: number
): boolean {
  if (financials.creditLimit === null) return false;
  return financials.outstandingBalance + toNumber(orderValue) > financials.creditLimit;
}

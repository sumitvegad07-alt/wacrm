/**
 * Payment date policy.
 *
 * Mirrors the bounds enforced by enforce_payment_status_transition() on insert. The
 * database is authoritative — the mobile app writes the payments table directly and
 * never runs this code — but the web form uses it to fail fast with a clearer message.
 *
 * Two rules:
 *   - A collection cannot be dated in the future. There is no legitimate case, and a
 *     forward-dated payment silently suppresses an overdue flag until that date passes.
 *   - A collection older than the account's `allow_backdate_days` window needs the
 *     `backdate_payments` permission. Backdating is sometimes real (a cheque handed
 *     over last week, entered today), so it is gated rather than banned.
 */

export const DEFAULT_ALLOW_BACKDATE_DAYS = 30;

export interface PaymentDatePolicy {
  /** How many days back an ordinary user may date a collection. */
  allowBackdateDays?: number | null;
  /** Whether the current user holds `backdate_payments`. */
  canBackdate?: boolean;
}

export interface PaymentDateCheck {
  ok: boolean;
  /** Null when ok; otherwise a message suitable for showing to the collector. */
  error: string | null;
  ageDays: number;
}

function toUtcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * @param paymentDate the date on the collection (Date, or an ISO yyyy-mm-dd string)
 * @param today       the reference date, normally the server's
 */
export function validatePaymentDate(
  paymentDate: Date | string,
  today: Date | string,
  policy: PaymentDatePolicy = {}
): PaymentDateCheck {
  const pd = typeof paymentDate === 'string' ? new Date(`${paymentDate}T00:00:00Z`) : paymentDate;
  const td = typeof today === 'string' ? new Date(`${today}T00:00:00Z`) : today;

  if (Number.isNaN(pd.getTime())) {
    return { ok: false, error: 'Payment date is not a valid date', ageDays: 0 };
  }

  const ageDays = Math.round((toUtcMidnight(td) - toUtcMidnight(pd)) / 86_400_000);

  if (ageDays < 0) {
    return { ok: false, error: 'Payment date cannot be in the future', ageDays };
  }

  const limit = policy.allowBackdateDays ?? DEFAULT_ALLOW_BACKDATE_DAYS;

  if (ageDays > limit) {
    if (policy.canBackdate) {
      return { ok: true, error: null, ageDays };
    }
    return {
      ok: false,
      error: `Payment date is ${ageDays} days old; the limit is ${limit} days. Ask an administrator for the backdate permission.`,
      ageDays,
    };
  }

  return { ok: true, error: null, ageDays };
}

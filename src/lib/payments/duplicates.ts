/**
 * Business-level duplicate detection for collections.
 *
 * The primary key already stops a *technical* duplicate — a retried offline queue item
 * replaying the same client-generated id. It does nothing about a *human* duplicate:
 * a rep tapping Save twice on a slow screen produces two rows with different ids and
 * identical content, and the pilot accepted ten of them without comment.
 *
 * This is deliberately a warning, never a block. Repeat collections from the same
 * customer for the same amount on the same day are unusual but legitimate, and a hard
 * refusal would strand a rep at the counter with no way to record real money.
 *
 * Mirrors check_duplicate_payment() in the database, which is also called on insert so
 * a duplicate arriving from mobile or the API is still logged for finance to review.
 */

export const DEFAULT_DUPLICATE_WINDOW_MINUTES = 60;

export interface ExistingPayment {
  id: string;
  payment_number?: string | null;
  contact_id: string;
  amount: number;
  payment_date: string;
  status: string;
  created_at: string;
}

export interface DuplicateCandidate {
  contactId: string;
  amount: number;
  paymentDate: string;
  /** Excluded from the comparison — used when re-checking an existing row. */
  excludeId?: string;
}

export interface DuplicateCheck {
  isDuplicate: boolean;
  matches: ExistingPayment[];
  windowMinutes: number;
}

export function findDuplicatePayments(
  candidate: DuplicateCandidate,
  existing: ExistingPayment[],
  now: Date | number,
  windowMinutes: number = DEFAULT_DUPLICATE_WINDOW_MINUTES
): DuplicateCheck {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const cutoff = nowMs - windowMinutes * 60_000;

  const matches = existing.filter((p) => {
    if (candidate.excludeId && p.id === candidate.excludeId) return false;
    // A cancelled payment is not a duplicate — it has been reversed, and the collector
    // may well be re-entering it correctly.
    if (p.status === 'Cancelled') return false;
    if (p.contact_id !== candidate.contactId) return false;
    if (Number(p.amount) !== Number(candidate.amount)) return false;
    if (p.payment_date !== candidate.paymentDate) return false;
    return new Date(p.created_at).getTime() >= cutoff;
  });

  return { isDuplicate: matches.length > 0, matches, windowMinutes };
}

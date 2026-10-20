// ============================================================
// The invoice lifecycle, in one place.
//
// draft → issued → part_paid → paid, with cancelled reachable from anything
// not yet terminal. Nothing returns to draft: an issued invoice is a document
// that has left the building, and re-editing it would change figures a
// customer and a CA have already seen.
//
// Validated here AND re-checked in the API route. The client disables the
// buttons; the route is what actually refuses.
// ============================================================

import { INVOICE_STATUSES, type InvoiceStatus } from "./types";

const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["part_paid", "paid", "cancelled"],
  part_paid: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function nextStatuses(from: InvoiceStatus): InvoiceStatus[] {
  return [...(ALLOWED[from] ?? [])];
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/** Only a draft may be edited. Everything else is frozen. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === "draft";
}

/**
 * The columns a status change writes.
 *
 * `paid` records the whole total as received and stamps the date. `part_paid`
 * records what the founder entered, clamped to the total, and leaves `paid_at`
 * null — a part payment that happens to equal the total is still recorded as
 * part paid, because promoting it would stamp a payment date he did not enter.
 */
export function statusPatch(
  to: InvoiceStatus,
  amountReceived: number,
  total: number,
  today: string,
): Record<string, unknown> {
  const cap = Math.max(0, Number(total) || 0);

  if (to === "paid") {
    return { status: to, amount_received: cap, paid_at: today };
  }

  if (to === "part_paid") {
    const received = Math.min(cap, Math.max(0, Number(amountReceived) || 0));
    return { status: to, amount_received: received, paid_at: null };
  }

  return { status: to };
}

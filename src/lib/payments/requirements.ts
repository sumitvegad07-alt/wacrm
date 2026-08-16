/**
 * The three "Require ..." payment settings, resolved into rules a form can apply.
 *
 * These settings existed in Settings -> Payments for months and were read by nothing —
 * the switches saved and no code consulted them. The authoritative enforcement now lives
 * in database triggers (`enforce_payment_required_fields`,
 * `enforce_payment_attachment_on_approval`), because the mobile app writes the `payments`
 * table directly through its offline queue and never calls an RPC.
 *
 * This module exists so the browser can apply the same rules a moment earlier and tell
 * the collector what is missing, instead of letting them fill in a form and then handing
 * them a raw database error. It is a mirror, never the source of truth — if the two ever
 * disagree, the trigger wins and the save fails, which is the safe direction.
 */

export interface PaymentSettings {
  require_notes?: boolean;
  require_reference?: boolean;
  require_attachment?: boolean;
}

export interface PaymentTypeOption {
  id: string;
  name: string;
  /** Whether this instrument carries a reference number at all. Cash does not. */
  requires_reference?: boolean;
}

export interface PaymentRequirementInput {
  settings: PaymentSettings | null | undefined;
  paymentTypes: PaymentTypeOption[];
  selectedPaymentTypeId: string | null | undefined;
}

export interface PaymentRequirements {
  notes: boolean;
  /**
   * True only when the setting is on AND the chosen instrument actually has a reference.
   * A literal reading of the setting would demand a cheque number for a cash collection,
   * which either blocks the commonest field payment or trains reps to type junk into a
   * financial field.
   */
  reference: boolean;
  attachment: boolean;
}

export function resolvePaymentRequirements({
  settings,
  paymentTypes,
  selectedPaymentTypeId,
}: PaymentRequirementInput): PaymentRequirements {
  const selectedType = paymentTypes.find((t) => t.id === selectedPaymentTypeId);

  return {
    notes: settings?.require_notes === true,
    reference:
      settings?.require_reference === true && selectedType?.requires_reference === true,
    attachment: settings?.require_attachment === true,
  };
}

export interface PaymentDraft {
  notes?: string | null;
  reference_number?: string | null;
  hasAttachment: boolean;
}

/**
 * Returns a message naming what is missing, or null when the draft satisfies the rules.
 * One message rather than a list: a collector standing in a shop fixes one thing at a
 * time, and the field is highlighted anyway.
 */
export function findMissingRequirement(
  requirements: PaymentRequirements,
  draft: PaymentDraft,
  paymentTypeName?: string
): string | null {
  const blank = (v: string | null | undefined) => !v || v.trim() === '';

  if (requirements.notes && blank(draft.notes)) {
    return 'A note is required on every payment.';
  }

  if (requirements.reference && blank(draft.reference_number)) {
    return `A reference number is required for ${
      paymentTypeName || 'this payment type'
    } — the cheque number, transaction id or UTR.`;
  }

  if (requirements.attachment && !draft.hasAttachment) {
    return 'Proof of payment is required. Attach a photo of the receipt or cheque.';
  }

  return null;
}

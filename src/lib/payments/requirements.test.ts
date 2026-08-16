import { describe, it, expect } from 'vitest';
import {
  resolvePaymentRequirements,
  findMissingRequirement,
  type PaymentTypeOption,
} from './requirements';

const CASH: PaymentTypeOption = { id: 'cash', name: 'Cash', requires_reference: false };
const CHEQUE: PaymentTypeOption = { id: 'chq', name: 'Cheque', requires_reference: true };
const TYPES = [CASH, CHEQUE];

describe('resolvePaymentRequirements', () => {
  it('requires nothing when the account has no payment settings', () => {
    expect(
      resolvePaymentRequirements({ settings: null, paymentTypes: TYPES, selectedPaymentTypeId: 'chq' })
    ).toEqual({ notes: false, reference: false, attachment: false });
  });

  it('never demands a reference for cash, even with the setting on', () => {
    // The whole point of the payment_types.requires_reference column. A literal reading of
    // require_reference would make the commonest field collection impossible to record.
    const req = resolvePaymentRequirements({
      settings: { require_reference: true },
      paymentTypes: TYPES,
      selectedPaymentTypeId: 'cash',
    });
    expect(req.reference).toBe(false);
  });

  it('demands a reference for a cheque when the setting is on', () => {
    const req = resolvePaymentRequirements({
      settings: { require_reference: true },
      paymentTypes: TYPES,
      selectedPaymentTypeId: 'chq',
    });
    expect(req.reference).toBe(true);
  });

  it('does not demand a reference for a cheque when the setting is off', () => {
    const req = resolvePaymentRequirements({
      settings: { require_reference: false },
      paymentTypes: TYPES,
      selectedPaymentTypeId: 'chq',
    });
    expect(req.reference).toBe(false);
  });

  it('treats an unknown payment type as carrying no reference', () => {
    // A custom type added after this feature shipped defaults to requires_reference=false
    // in the database; the client must not invent a stricter rule than the trigger.
    const req = resolvePaymentRequirements({
      settings: { require_reference: true },
      paymentTypes: TYPES,
      selectedPaymentTypeId: 'something-else',
    });
    expect(req.reference).toBe(false);
  });

  it('applies notes and attachment regardless of payment type', () => {
    const req = resolvePaymentRequirements({
      settings: { require_notes: true, require_attachment: true },
      paymentTypes: TYPES,
      selectedPaymentTypeId: 'cash',
    });
    expect(req.notes).toBe(true);
    expect(req.attachment).toBe(true);
  });
});

describe('findMissingRequirement', () => {
  const none = { notes: false, reference: false, attachment: false };

  it('passes a draft that satisfies every rule', () => {
    expect(
      findMissingRequirement(
        { notes: true, reference: true, attachment: true },
        { notes: 'Collected at counter', reference_number: 'CHQ-1', hasAttachment: true },
        'Cheque'
      )
    ).toBeNull();
  });

  it('passes anything when no rule is switched on', () => {
    expect(
      findMissingRequirement(none, { notes: '', reference_number: '', hasAttachment: false })
    ).toBeNull();
  });

  it('rejects whitespace as a note', () => {
    expect(
      findMissingRequirement({ ...none, notes: true }, { notes: '   ', hasAttachment: true })
    ).toMatch(/note is required/i);
  });

  it('rejects whitespace as a reference and names the instrument', () => {
    const msg = findMissingRequirement(
      { ...none, reference: true },
      { notes: 'x', reference_number: ' ', hasAttachment: true },
      'Cheque'
    );
    expect(msg).toMatch(/Cheque/);
    expect(msg).toMatch(/reference number is required/i);
  });

  it('rejects a missing proof photo', () => {
    expect(
      findMissingRequirement({ ...none, attachment: true }, { notes: 'x', hasAttachment: false })
    ).toMatch(/proof of payment/i);
  });

  it('reports one thing at a time, in form order', () => {
    const msg = findMissingRequirement(
      { notes: true, reference: true, attachment: true },
      { notes: '', reference_number: '', hasAttachment: false },
      'Cheque'
    );
    expect(msg).toMatch(/note is required/i);
  });
});

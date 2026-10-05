import { describe, expect, test } from 'vitest';
import {
  DEFAULT_OUTSTANDING_CONFIG,
  ORDER_STATUS_PRESETS,
  PAYMENT_STATUS_PRESETS,
  matchOrderPreset,
  matchPaymentPreset,
  readOutstandingConfig,
} from './outstanding-config';

// ---------------------------------------------------------------------------
// Which orders count as money owed, and which payments count as money received,
// is now the admin's decision rather than a hard-wired `status = 'Closed'`.
// Some distributors treat a booked order as debt immediately; others only once
// it closes. Both are right, so the account picks.
//
// The rule these tests guard hardest: an account that has never touched the
// setting must produce EXACTLY today's numbers. Outstanding is derived live on
// every screen, so a drifting default would silently restate every customer's
// balance across all 33 live accounts.
// ---------------------------------------------------------------------------

describe('readOutstandingConfig', () => {
  test('an account that never saved the setting keeps the old behaviour', () => {
    expect(readOutstandingConfig(undefined)).toEqual({
      orderStatuses: ['Closed'],
      paymentStatuses: ['Approved'],
    });
  });

  test('reads the statuses an admin chose', () => {
    const config = readOutstandingConfig({
      outstanding_settings: {
        order_statuses: ['Pending', 'Approved', 'Closed'],
        payment_statuses: ['Pending', 'Approved'],
      },
    });

    expect(config.orderStatuses).toEqual(['Pending', 'Approved', 'Closed']);
    expect(config.paymentStatuses).toEqual(['Pending', 'Approved']);
  });

  test('drops a status the orders table could never hold', () => {
    const config = readOutstandingConfig({
      outstanding_settings: { order_statuses: ['Closed', 'Teleported'] },
    });

    expect(config.orderStatuses).toEqual(['Closed']);
  });

  test('drops a duplicate so a status cannot be counted twice', () => {
    const config = readOutstandingConfig({
      outstanding_settings: { order_statuses: ['Closed', 'Closed', 'Pending'] },
    });

    expect(config.orderStatuses).toEqual(['Pending', 'Closed']);
  });

  test('falls back to the default when the saved list is empty', () => {
    // An empty list would zero every customer's outstanding. A corrupt or
    // half-written setting must never do that silently.
    const config = readOutstandingConfig({
      outstanding_settings: { order_statuses: [], payment_statuses: [] },
    });

    expect(config).toEqual(DEFAULT_OUTSTANDING_CONFIG);
  });

  test('falls back to the default when the setting is the wrong shape', () => {
    const config = readOutstandingConfig({ outstanding_settings: { order_statuses: 'Closed' } });

    expect(config.orderStatuses).toEqual(['Closed']);
  });

  test('each side falls back on its own', () => {
    const config = readOutstandingConfig({
      outstanding_settings: { payment_statuses: ['Pending', 'Approved'] },
    });

    expect(config.orderStatuses).toEqual(['Closed']);
    expect(config.paymentStatuses).toEqual(['Pending', 'Approved']);
  });
});

describe('presets', () => {
  test('"on order creation" counts every order that was not called off', () => {
    expect(ORDER_STATUS_PRESETS.on_creation).toEqual([
      'Pending',
      'Approved',
      'Part Dispatch',
      'Dispatched',
      'Closed',
    ]);
  });

  test('"on dispatch" counts an order once any goods have left', () => {
    expect(ORDER_STATUS_PRESETS.on_dispatch).toEqual(['Part Dispatch', 'Dispatched', 'Closed']);
  });

  test('"on close" is the default and matches the old hard-wired rule', () => {
    expect(ORDER_STATUS_PRESETS.on_close).toEqual(['Closed']);
    expect(DEFAULT_OUTSTANDING_CONFIG.orderStatuses).toEqual(ORDER_STATUS_PRESETS.on_close);
  });

  test('no preset ever counts a Cancelled or Rejected order as money owed', () => {
    for (const statuses of Object.values(ORDER_STATUS_PRESETS)) {
      expect(statuses).not.toContain('Cancelled');
      expect(statuses).not.toContain('Rejected');
    }
  });

  test('no preset ever counts a Cancelled or Rejected payment as money received', () => {
    for (const statuses of Object.values(PAYMENT_STATUS_PRESETS)) {
      expect(statuses).not.toContain('Cancelled');
      expect(statuses).not.toContain('Rejected');
    }
  });
});

describe('matchOrderPreset', () => {
  test('names the preset an admin picked so Settings can show it selected', () => {
    expect(matchOrderPreset(['Part Dispatch', 'Dispatched', 'Closed'])).toBe('on_dispatch');
  });

  test('ignores the order the statuses were saved in', () => {
    expect(matchOrderPreset(['Closed', 'Dispatched', 'Part Dispatch'])).toBe('on_dispatch');
  });

  test('calls a hand-picked combination custom', () => {
    expect(matchOrderPreset(['Pending', 'Closed'])).toBe('custom');
  });
});

describe('matchPaymentPreset', () => {
  test('recognises the default', () => {
    expect(matchPaymentPreset(['Approved'])).toBe('approved_only');
  });

  test('recognises counting uncollected payments too', () => {
    expect(matchPaymentPreset(['Approved', 'Pending'])).toBe('pending_and_approved');
  });
});

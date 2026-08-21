/**
 * Stock maths for the Stock Management module.
 *
 * Closing stock is DERIVED, never stored — exactly like customer outstanding
 * (`src/lib/payments/financials.ts`). The one place the number is defined:
 *
 *   Closing stock = SUM(stock_ledger.quantity)   [signed rows]
 *                 = opening + inward - outward - net reversals
 *
 * The `stock_positions` DB view does the per-product rollup (security_invoker,
 * so tenant RLS applies). These helpers wrap it so no screen re-derives the
 * number its own way.
 */

export type StockOutEvent = 'order_created' | 'order_closed' | 'dispatch';

export interface StockSettings {
  stockOutEvent: StockOutEvent;
  restrictOnInsufficient: boolean;
}

// Reason codes are direction-aware — most only make sense one way. Two
// (Stock Correction, Physical Count Adjustment) work either way. The DB CHECK
// enforces the full union.
export const STOCK_IN_REASONS = [
  'Purchase',
  'Sales Return',
  'Production',
  'Opening Load',
  'Transfer In',
  'Stock Correction',
  'Physical Count Adjustment',
] as const;

export const STOCK_OUT_REASONS = [
  'Damage',
  'Expiry',
  'Theft/Loss',
  'Purchase Return',
  'Transfer Out',
  'Stock Correction',
  'Physical Count Adjustment',
] as const;

/** Every valid manual reason (the DB CHECK list). */
export const STOCK_REASON_CODES = Array.from(
  new Set<string>([...STOCK_IN_REASONS, ...STOCK_OUT_REASONS])
);

export function stockReasonsFor(direction: 'in' | 'out'): readonly string[] {
  return direction === 'in' ? STOCK_IN_REASONS : STOCK_OUT_REASONS;
}

export type StockReasonCode = (typeof STOCK_IN_REASONS)[number] | (typeof STOCK_OUT_REASONS)[number];

export const STOCK_OUT_EVENT_LABEL: Record<StockOutEvent, string> = {
  order_created: 'when an order is created',
  order_closed: 'when an order is Closed',
  dispatch: 'when goods are dispatched',
};

export interface StockPosition {
  productId: string;
  productName: string;
  sku: string | null;
  unit: string | null;
  active: boolean | null;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  lastMovementAt: string | null;
}

export interface StockLedgerEntry {
  id: string;
  productId: string;
  productName?: string;
  quantity: number;
  entryType: 'opening' | 'manual_in' | 'manual_out' | 'sale_out' | 'reversal';
  reasonCode: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceRef: string | null;
  voucherNo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Money/quantity arrives from Postgres NUMERIC as strings often enough to coerce. */
export function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/** Read the account's stock behaviour from `accounts.settings.stock_settings`. */
export function readStockSettings(settings: unknown): StockSettings {
  const ss =
    settings && typeof settings === 'object'
      ? ((settings as Record<string, unknown>).stock_settings as Record<string, unknown> | undefined)
      : undefined;
  const event = ss?.stock_out_event;
  return {
    stockOutEvent:
      event === 'order_created' || event === 'order_closed' || event === 'dispatch'
        ? event
        : 'order_closed',
    restrictOnInsufficient: ss?.restrict_on_insufficient === true,
  };
}

/** Would this ordered quantity exceed what is available? (available < ordered) */
export function exceedsAvailable(closing: number, orderedQty: number): boolean {
  return toNumber(orderedQty) > toNumber(closing);
}

type Db = { from: (t: string) => any };

function mapPosition(row: Record<string, unknown>): StockPosition {
  return {
    productId: row.product_id as string,
    productName: (row.product_name as string) ?? '',
    sku: (row.sku as string) ?? null,
    unit: (row.unit as string) ?? null,
    active: (row.active as boolean) ?? null,
    opening: toNumber(row.opening),
    totalIn: toNumber(row.total_in),
    totalOut: toNumber(row.total_out),
    closing: toNumber(row.closing),
    lastMovementAt: (row.last_movement_at as string) ?? null,
  };
}

/** All tracked-product positions for the account (stock screen + report + low-stock). */
export async function fetchStockPositions(db: Db, accountId: string): Promise<StockPosition[]> {
  const { data } = await db
    .from('stock_positions')
    .select('*')
    .eq('account_id', accountId)
    .order('product_name');
  return ((data as Record<string, unknown>[]) ?? []).map(mapPosition);
}

/**
 * Closing stock keyed by product id, for a specific set of products (the order
 * form). One grouped query via the view — no N+1.
 */
export async function fetchClosingStock(
  db: Db,
  accountId: string,
  productIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const { data } = await db
    .from('stock_positions')
    .select('product_id, closing')
    .eq('account_id', accountId)
    .in('product_id', productIds);
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    out.set(row.product_id as string, toNumber(row.closing));
  }
  return out;
}

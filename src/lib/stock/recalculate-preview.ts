/**
 * What a stock recalculation WOULD post, worked out before anything is posted.
 *
 * Recalculating is append-only and idempotent, but it is not harmless: it
 * reconciles orders the ledger has never seen, including ones closed long
 * before anybody switched Stock Management on. If the opening balance or a
 * manual stock-in was COUNTED AFTER those orders shipped, that figure already
 * reflects them — and posting them again subtracts the same sale twice.
 *
 * Only the person who counted the stock knows which it is. So the button shows
 * this first: how many orders, how far back, and which products. All read-only.
 */

/**
 * The same loose shape `financials.ts` uses. The generated database types are
 * not wired up here, and pinning a full SupabaseClient generic just to read
 * four tables fights the client's own typings for nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface RecalculatePreview {
  /** Orders that have no stock ledger rows yet and would get them. */
  orders: { orderNumber: string; closedOn: string | null }[];
  /** Distinct product names across those orders, and whether stock is tracked. */
  products: { name: string; tracked: boolean }[];
  /** The earliest order date involved — the "how far back" number. */
  oldest: string | null;
}

/**
 * Orders in a stock-out state that the ledger has no rows for.
 *
 * Mirrors what stock_reconcile_order would consider: under `order_closed` only
 * Closed orders consume, under `order_created` everything that is not
 * Cancelled or Rejected.
 */
export async function previewRecalculate(
  db: Db,
  accountId: string,
  stockOutEvent: string,
): Promise<RecalculatePreview> {
  const consuming =
    stockOutEvent === "order_created"
      ? ["Pending", "Approved", "Part Dispatch", "Dispatched", "Closed"]
      : ["Closed"];

  const [{ data: orders }, { data: ledger }] = await Promise.all([
    db
      .from("orders")
      .select("id, order_number, date, updated_at")
      .eq("account_id", accountId)
      .in("status", consuming),
    db.from("stock_ledger").select("source_id").eq("source_type", "order"),
  ]);

  const posted = new Set(
    ((ledger ?? []) as { source_id: string | null }[]).map((l) => l.source_id),
  );
  const missing = ((orders ?? []) as {
    id: string;
    order_number: string;
    date: string | null;
    updated_at: string | null;
  }[]).filter((o) => !posted.has(o.id));

  if (missing.length === 0) return { orders: [], products: [], oldest: null };

  const { data: items } = await db
    .from("order_items")
    .select("order_id, product_id, product_name")
    .in(
      "order_id",
      missing.map((o) => o.id),
    );

  const productIds = [
    ...new Set(
      ((items ?? []) as { product_id: string | null }[])
        .map((i) => i.product_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  let products: { name: string; tracked: boolean }[] = [];
  if (productIds.length > 0) {
    const { data: rows } = await db
      .from("products")
      .select("name, track_stock")
      .in("id", productIds);
    products = ((rows ?? []) as { name: string; track_stock: boolean | null }[]).map((p) => ({
      name: p.name,
      tracked: p.track_stock === true,
    }));
  }

  const dates = missing.map((o) => o.date ?? o.updated_at).filter(Boolean) as string[];
  dates.sort();

  return {
    orders: missing
      .map((o) => ({ orderNumber: o.order_number, closedOn: o.date ?? o.updated_at }))
      .sort((a, b) => String(a.closedOn).localeCompare(String(b.closedOn))),
    products,
    oldest: dates[0] ?? null,
  };
}

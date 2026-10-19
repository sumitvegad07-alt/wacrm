-- ============================================================
-- 20261019120000_summary_report_modules.sql
--
-- Two new reports for the "Summary Report" section, both on the existing
-- generic report engine. Spec: docs/superpowers/specs/2026-10-19-summary-reports-design.md
--
--  1. product_summary    — one row per customer AND product.
--  2. order_outstanding  — one row per order, with a per-order balance.
--
-- Neither gets its own copy of the Order registry. Both resolve against an
-- ordered module list (['<own>', 'order']), so a row registered here wins and
-- everything else — 12 dimensions, 19 filters, 5 joins — is inherited verbatim.
-- See report-engine.md §5b.
--
-- Nothing in the `order` module is modified. The fan-out overstatement on the
-- Order and Sales reports' own Product tabs is deliberately left alone: fixing
-- it there would move numbers on two shipped reports and needs its own decision.
-- ============================================================


-- ============================================================
-- PART 1 — Per-order outstanding (FIFO), as a single-pass view
-- ============================================================
-- `payments` has a contact_id and NO order_id: a payment settles a customer,
-- not an invoice. So a per-order balance has to be DERIVED, and the founder's
-- rule (2026-10-19) is oldest-first: a customer's received payments settle
-- their opening balance first, then their oldest counted order, then the next.
--
--   prior_debt(X)  = opening_balance(C) + SUM(C's counted orders before X)
--   received(C)    = SUM(COALESCE(verified_amount, amount) of C's counted payments)
--   allocated(X)   = LEAST(X.total, GREATEST(received(C) - prior_debt(X), 0))
--   outstanding(X) = X.total - allocated(X)
--
-- WHY A VIEW AND NOT A PER-ROW FUNCTION. The obvious shape — one scalar
-- function called per order row, which is how customer_outstanding() works —
-- was written, registered and executed against prod first, and it CANCELLED ON
-- STATEMENT TIMEOUT (57014) on a 3,338-order account. "Sum every earlier order
-- of this customer" is a correlated subquery whose cost is quadratic in a
-- customer's order count, re-run for every row of the report.
--
-- Here `prior_debt` is instead a window SUM over each customer's orders, so the
-- whole account is computed in ONE pass: scan, partition, running total. The
-- report then joins the answer per row instead of recomputing it per row.
--
-- WHY THE VIEW IS NOT security_invoker. Allocation needs the customer's WHOLE
-- ledger. execute_report is SECURITY INVOKER (it must be — tenant and area
-- visibility depend on it), so under the caller's RLS a rep who can only see
-- their own orders would compute a smaller prior debt, allocate too much, and
-- read a different balance than their manager for the same order. This view
-- runs as its owner and therefore sees the full ledger, exactly as the
-- SECURITY DEFINER customer_outstanding() does.
--
-- Tenant isolation is NOT lost by that: the `rules` CTE is gated by
-- is_account_member(), and every other CTE joins it, so the view can only ever
-- emit rows for an account the caller belongs to. Selecting from it directly as
-- a rep returns their own account and nothing else. Supabase's advisor will
-- flag it as an RLS-bypassing view; this comment is the reason it is deliberate.
--
-- Which statuses count is NOT redefined here. The rule comes from
-- outstanding_order_statuses() / outstanding_payment_statuses()
-- (20261005130000_outstanding_rule_and_stored_balance.sql), evaluated ONCE per
-- account in `rules` rather than once per row, so this report can never
-- disagree with the customer list or the dashboard.

CREATE OR REPLACE VIEW public.order_outstanding_balances AS
WITH rules AS (
  -- One call per account, not per row. is_account_member() is what keeps an
  -- owner-rights view from leaking across tenants.
  SELECT a.id AS account_id,
         outstanding_order_statuses(a.id)   AS order_statuses,
         outstanding_payment_statuses(a.id) AS payment_statuses
    FROM accounts a
   WHERE is_account_member(a.id)
),
counted AS (
  -- Only orders the account treats as debt enter the queue. An order in any
  -- other status (Cancelled, Rejected) is absent here, so the report's LEFT
  -- JOIN leaves it at 0 — it owes nothing and has received nothing.
  --
  -- (date, created_at, id) is a total, stable order: two orders written on the
  -- same date still queue deterministically, so no payment is counted twice and
  -- none is skipped.
  SELECT o.id          AS order_id,
         o.account_id,
         o.contact_id,
         COALESCE(o.total_amount, 0) AS order_total,
         COALESCE(SUM(COALESCE(o.total_amount, 0)) OVER (
                    PARTITION BY o.account_id, o.contact_id
                    ORDER BY o.date, o.created_at, o.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                  ), 0) AS prior_orders
    FROM orders o
    JOIN rules r ON r.account_id = o.account_id
   WHERE o.status = ANY (r.order_statuses)
),
received AS (
  -- An approver may verify a different figure than the rep collected; the
  -- verified figure wins once present, and NULL means "not yet verified", not
  -- zero. Joined on contact_id with `=`, so a payment whose customer was
  -- deleted (contact_id NULL) settles nothing rather than being spread over
  -- every customer-less order.
  SELECT p.account_id,
         p.contact_id,
         SUM(COALESCE(p.verified_amount, p.amount)) AS received
    FROM payments p
    JOIN rules r ON r.account_id = p.account_id
   WHERE p.status = ANY (r.payment_statuses)
   GROUP BY p.account_id, p.contact_id
)
SELECT k.order_id,
       k.account_id,
       k.contact_id,
       k.order_total,
       -- GREATEST(order_total, 0) inside LEAST so a credit note (negative
       -- total) allocates nothing and surfaces as a negative balance, rather
       -- than cancelling itself out to zero.
       LEAST(GREATEST(k.order_total, 0),
             GREATEST(COALESCE(rc.received, 0)
                      - (COALESCE(c.opening_balance, 0) + k.prior_orders), 0)) AS received_on_order,
       k.order_total
         - LEAST(GREATEST(k.order_total, 0),
                 GREATEST(COALESCE(rc.received, 0)
                          - (COALESCE(c.opening_balance, 0) + k.prior_orders), 0)) AS outstanding
  FROM counted k
  LEFT JOIN contacts c  ON c.id = k.contact_id
  LEFT JOIN received rc ON rc.account_id = k.account_id AND rc.contact_id = k.contact_id;

COMMENT ON VIEW public.order_outstanding_balances IS
  'Per-order balance under the account''s own outstanding rule, by oldest-first '
  'allocation of each customer''s payments (opening balance first, then orders by '
  '(date, created_at, id)). Holds a row only for orders in a status the account '
  'counts as debt. SUM(outstanding) over a customer''s orders equals '
  'customer_outstanding() MINUS any opening balance still unsettled — opening '
  'balance is debt with no order to sit on. Owner-rights by design (allocation '
  'needs the whole ledger); scoped to the caller''s accounts by is_account_member().';

REVOKE ALL ON public.order_outstanding_balances FROM anon;
GRANT SELECT ON public.order_outstanding_balances TO authenticated;

-- One order's balance, for callers that have an order and not a report (the
-- order detail screen, mobile). A thin read of the view, so there is exactly ONE
-- implementation of the allocation rule — the duplication that
-- outstanding-config.ts was created to end.
CREATE OR REPLACE FUNCTION public.order_outstanding_amount(p_order_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $fn$
  -- COALESCE, not NULL: an order the account does not count as debt has no row
  -- in the view and owes nothing. An order outside the caller's accounts also
  -- has no row — but it is unreachable anyway, so 0 leaks nothing.
  SELECT COALESCE((SELECT b.outstanding
                     FROM order_outstanding_balances b
                    WHERE b.order_id = p_order_id), 0);
$fn$;

COMMENT ON FUNCTION public.order_outstanding_amount(uuid) IS
  'What is still unpaid on ONE order. Reads order_outstanding_balances, which '
  'holds the allocation rule. Returns 0 for an order in a status the account does '
  'not count as debt. Do NOT call this per row in a report — join the view.';

REVOKE ALL ON FUNCTION public.order_outstanding_amount(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.order_outstanding_amount(uuid) TO authenticated;


-- ============================================================
-- PART 2 — Teach execute_report the two modules
-- ============================================================
-- Patched in place off pg_get_functiondef: idempotent, and it refuses to run if
-- the module switch has drifted rather than patching blindly. Same pattern as
-- the DSR migration (20260818180000).

DO $do$
DECLARE
  v_def    text;
  v_anchor text := E'  ELSE\n    RAISE EXCEPTION ''Unsupported module: %'', p_module;\n  END IF;';
  v_new    text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'execute_report';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_report not found';
  END IF;

  IF position('p_module = ''product_summary''' IN v_def) > 0 THEN
    RAISE NOTICE 'execute_report already knows the summary modules; nothing to do';
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'execute_report module switch has drifted; refusing to patch blindly';
  END IF;

  v_new := $repl$  -- Product Summary. Same base table and registry as `order`; overrides the
  -- order-level quantity/amount measures with item-level twins, because this
  -- report's grain is the order LINE. See §5l.
  ELSIF p_module = 'product_summary' THEN
    v_base_table := 'orders';
    v_registry_modules := ARRAY['product_summary', 'order'];
  -- Customer Outstanding. One row per order; the balance is allocated
  -- oldest-first by the order_outstanding_balances view. See §5l.
  ELSIF p_module = 'order_outstanding' THEN
    v_base_table := 'orders';
    v_registry_modules := ARRAY['order_outstanding', 'order'];
$repl$ || v_anchor;

  EXECUTE replace(v_def, v_anchor, v_new);
END
$do$;


-- ============================================================
-- PART 3 — product_summary registry
-- ============================================================
-- Dimensions, filters and joins are ALL inherited from `order`.
--
-- Only the measures differ, and they have to: the grain here is the order line,
-- while `order`'s quantity/amount measures are order-level rollups. On module
-- `order`, product_quantity is SUM(COALESCE(isum.product_quantity, 0)) — one
-- order's whole quantity, repeated once per product row. That is the
-- long-standing overstatement on the Order and Sales Product tabs. Registering
-- item-level twins under the SAME keys makes module-ordered resolution pick the
-- right arithmetic for this report without touching the other two.

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
-- The two the founder actually asked for.
('product_summary', 'product_quantity', 'Quantity',   'SUM(i.quantity)',                                  'number',   '["order_items"]'),
('product_summary', 'net_amount',       'Amount',     'SUM(i.total)',                                     'currency', '["order_items"]'),
-- Multi Unit: entered 2 BOX of 12 reads as 24 here. COALESCE for legacy and
-- single-unit lines, whose base_quantity is NULL and equals their quantity.
('product_summary', 'base_quantity',    'Base Quantity',
 'SUM(COALESCE(i.base_quantity, i.quantity))', 'number', '["order_items"]'),
('product_summary', 'gross_amount',     'Sub Amount', 'SUM(i.sub_total)',                                 'currency', '["order_items"]'),
('product_summary', 'tax_amount',       'Tax Amount', 'SUM(i.tax_amount)',                                'currency', '["order_items"]'),
('product_summary', 'product_count',    '# of product', 'COUNT(DISTINCT i.product_id)',                   'number',   '["order_items"]'),
-- Weighted: total money over total pieces. AVG(i.price) — which `order`
-- registers as avg_price — averages the line RATES instead, so one stray
-- single-piece line swings it. A ratio is never summed in the footer (§5e).
('product_summary', 'avg_rate',         'Avg Rate',
 'ROUND((SUM(i.total) / NULLIF(SUM(i.quantity), 0))::numeric, 2)', 'currency', '["order_items"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select,
      type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;


-- ============================================================
-- PART 4 — order_outstanding registry
-- ============================================================

-- ── Joins ────────────────────────────────────────────────────
-- The balance is computed once for the whole account by the view and joined per
-- row. LEFT, so an order in a status the account does not count as debt — which
-- has no row in the view — reads 0 rather than vanishing from the report.
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
('order_outstanding', 'outstanding',
 'LEFT JOIN order_outstanding_balances oo ON oo.order_id = base.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ───────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('order_outstanding', 'order_number', 'Order Number', 'base.order_number', '[]'),
-- `order` registers `date` as TO_CHAR(base.date, 'FMMonth YYYY') — a month
-- bucket, which is right for a Period tab and wrong on a single order's row.
('order_outstanding', 'order_date', 'Order Date', 'TO_CHAR(base.date, ''YYYY-MM-DD'')', '[]'),
-- The point of the report: a number a rep can actually ring. contacts.phone is
-- NOT NULL but can be blank on an imported record.
('order_outstanding', 'customer_phone', 'Contact Number',
 'COALESCE(NULLIF(c.phone, ''''), ''-'')', '["contacts"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ─────────────────────────────────────────────────
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('order_outstanding', 'order_amount', 'Order Amount', 'SUM(COALESCE(base.total_amount, 0))', 'currency', '[]'),
('order_outstanding', 'outstanding_amount', 'Outstanding',
 'SUM(COALESCE(oo.outstanding, 0))', 'currency', '["outstanding"]'),
-- Received + Outstanding = Order Amount holds over COUNTED orders only. A
-- Cancelled order reads Order Amount 5,000 / Received 0 / Outstanding 0, which
-- is correct: it was called off, so nothing is owed and nothing was paid on it.
('order_outstanding', 'received_amount', 'Received Amount',
 'SUM(COALESCE(oo.received_on_order, 0))', 'currency', '["outstanding"]'),
-- The customer's TRUE total, straight off the stored cache, including any
-- opening balance that the per-order column cannot show. MAX, not SUM: one
-- value per customer, so this is only valid where the grain is the customer —
-- TabConfig.availableMeasures keeps it off the Order / Area / User tabs, where
-- it would repeat across a customer's rows or report an area's largest single
-- debtor as the area's total.
('order_outstanding', 'customer_balance', 'Customer Balance',
 'MAX(COALESCE(c.outstanding_balance, 0))', 'currency', '["contacts"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select,
      type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ──────────────────────────────────────────────────
-- All 19 order filters are inherited. This adds the one thing a collections
-- list needs that an order list does not.
--
-- Written so a cleared or unexpected value is a NO-OP rather than a filter that
-- hides everything: execute_report appends the predicate whenever the key is
-- present in p_filters, regardless of its value.
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('order_outstanding', 'only_outstanding', 'Only unpaid orders',
 '(($2::jsonb->>''only_outstanding'') IS DISTINCT FROM ''yes'' OR COALESCE(oo.outstanding, 0) > 0)',
 '["outstanding"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;


-- ============================================================
-- PART 5 — Supporting index
-- ============================================================
-- Matches the view's PARTITION BY / ORDER BY exactly, so the running total can
-- be read off an index scan instead of sorting the account's orders on every
-- call.
CREATE INDEX IF NOT EXISTS idx_orders_account_contact_date
  ON orders (account_id, contact_id, date, created_at, id);

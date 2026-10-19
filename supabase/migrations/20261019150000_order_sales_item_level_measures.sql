-- Order + Sales: item-level twins for the product-grain tabs
-- ============================================================
-- Fixes a long-standing overstatement on the Product, Product Category and
-- Product Sub-Category tabs of the Order report and the Sales report.
--
-- THE BUG. Those tabs group by a column that lives on `order_items`, so the
-- engine joins `order_items` and the base `orders` row is repeated once per
-- line. The quantity and amount measures `order` registers are ORDER-level
-- rollups read off the pre-aggregated `order_items_summary` join (alias `isum`,
-- one row per order) or straight off `base`:
--
--   product_quantity = SUM(COALESCE(isum.product_quantity, 0))
--   product_count    = SUM(COALESCE(isum.product_count, 0))
--   base_quantity    = SUM(COALESCE(isum.base_quantity, 0))
--   gross_amount     = SUM(base.sub_total)
--   net_amount       = SUM(base.total_amount)
--
-- At order grain every one of those is right and fan-out-proof. At line grain
-- each repeats the WHOLE order's figure once per product row.
--
-- MEASURED ON PROD, 2026-10-19, before this migration. Balaji Agencies
-- (3,338 orders), Order report, Product tab — Category and Sub-Category give
-- identical totals, and the Sales report behaves the same way:
--
--   Quantity        9,47,160  ->      2,45,798   (shown was +285.3%)
--   # of product      42,815  ->            30   (shown was +142,617%)
--   Base Quantity   9,47,160  ->      2,45,798   (+285.3%)
--   Sub Amount   4,90,11,148.98 -> 1,27,19,646.96 (+285.3%)
--   Amount       4,90,11,148.98 -> 1,27,19,646.96 (+285.3%)
--
-- The right-hand column was reconciled independently against `order_items`
-- outside the report engine (11,676 lines): SUM(quantity) 245,798.00 and
-- SUM(sub_total) 12,719,646.96, an exact match.
--
-- THE FIX, the pattern §5d already uses for Quotations: register a second,
-- item-level version of each measure under a NEW key with the SAME label, and
-- let `TabConfig.availableMeasures` decide which one a tab may use. The
-- order-level rows are NOT touched, so the Customer / User / Area / Period tabs
-- cannot move — verified: on both accounts that have orders, order-level and
-- item-level agree to the paisa on all four of those tabs.
--
-- `sales` registers no measures of its own, so module-ordered resolution
-- (v_registry_modules = ['sales','order'], §5b) hands it these rows too. One
-- insert fixes both reports and they cannot drift apart.
--
-- Deliberately NOT changed: `# of product` also differs on the order-grain tabs
-- (Customer tab, Balaji: 11,167 vs 3,436) but that is a definition difference,
-- not fan-out — order-level counts product LINES across the customer's orders,
-- item-level counts how many DIFFERENT products that customer bought. Both are
-- real answers to different questions, so the order-grain tabs keep theirs.
--
-- Registry-driven: no execute_report() change. Idempotent, and independent of
-- the still-unapplied 20261019120000_summary_report_modules.sql.

INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
-- Same labels as the order-level rows on purpose: the column reads identically
-- to the user, only the arithmetic is per line. `avg_price` needs no twin —
-- ROUND(AVG(i.price)) is already item-level. Nor do `order_count` and
-- `customer_count`: COUNT(DISTINCT …) is immune to the repeated rows.
('order', 'item_product_quantity', 'Quantity',      'SUM(COALESCE(i.quantity, 0))',                  'number',   '["order_items"]'),
('order', 'item_product_count',    '# of product',  'COUNT(DISTINCT i.product_id)',                  'number',   '["order_items"]'),
-- Multi Unit: 2 BOX of 12 reads as 24. COALESCE for legacy and single-unit
-- lines, whose base_quantity is NULL and equals their entered quantity.
('order', 'item_base_quantity',    'Base Quantity', 'SUM(COALESCE(i.base_quantity, i.quantity, 0))', 'number',   '["order_items"]'),
('order', 'item_gross_amount',     'Sub Amount',    'SUM(COALESCE(i.sub_total, 0))',                 'currency', '["order_items"]'),
('order', 'item_net_amount',       'Amount',        'SUM(COALESCE(i.total, 0))',                     'currency', '["order_items"]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select,
      type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;


-- The half-finished version of this same fix, left behind years ago: `order`
-- carried `item_amount` = SUM(i.sub_total), the measure §5 told users to pick by
-- hand. No report config ever exposed it, so no UI and no saved view can
-- reference it, and it is now a duplicate of `item_gross_amount`. Two identical
-- expressions under two keys is exactly the drift §5b warns about, so it goes.
DELETE FROM report_registry_measures
WHERE module_name = 'order' AND key = 'item_amount';

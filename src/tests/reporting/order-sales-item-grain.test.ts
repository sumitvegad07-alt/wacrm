import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';
import { salesReportConfig } from '@/lib/reports/salesReportConfig';
import type { ReportDefinition } from '@/lib/reports/types';

/**
 * Order + Sales: the product-grain tabs must stay on item-level arithmetic.
 *
 * Grouping by product, category or sub-category joins `order_items`, so the base
 * order row repeats once per line and every ORDER-level SUM is multiplied
 * (report-engine.md §5). Until 2026-10-19 those tabs used the order-level
 * measures and reported about 3.9x the truth — measured on prod at +285% on
 * Quantity, Base Quantity, Sub Amount and Amount, and +142,617% on # of product.
 * Migration 20261019150000_order_sales_item_level_measures.sql added the
 * `item_*` twins and the tabs were pointed at them.
 *
 * Nothing at runtime catches a regression here. Put an order-level measure back
 * on a product tab and the report still renders, still totals, still exports —
 * it is simply wrong, by a factor that looks plausible. Hence these tests.
 */

/** Order-level measure -> its item-level twin. Every one of these overstates on
 *  a product-grain tab, and every one has a twin registered under the same
 *  label. `order_count` / `customer_count` are absent on purpose: COUNT(DISTINCT
 *  …) is immune to the repeated rows. So is `avg_price`, already per line. */
const TWINS: Record<string, string> = {
  product_quantity: 'item_product_quantity',
  product_count: 'item_product_count',
  base_quantity: 'item_base_quantity',
  gross_amount: 'item_gross_amount',
  net_amount: 'item_net_amount',
};

const ORDER_LEVEL_KEYS = Object.keys(TWINS);
const ITEM_LEVEL_KEYS = Object.values(TWINS);

/** The tabs whose dimension lives on `order_items`. */
const PRODUCT_GRAIN_TABS = ['product', 'product_category', 'product_subcategory'];

const CONFIGS: ReportDefinition[] = [orderReportConfig, salesReportConfig];

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20261019150000_order_sales_item_level_measures.sql'
  ),
  'utf8'
);

describe.each(CONFIGS)('$moduleName report — product tabs are item-grain', (config) => {
  const tabs = config.tabConfigs ?? [];
  const productTabs = tabs.filter((t) => PRODUCT_GRAIN_TABS.includes(t.dimension));
  const orderTabs = tabs.filter((t) => !PRODUCT_GRAIN_TABS.includes(t.dimension));

  it('has all three product-grain tabs', () => {
    expect(productTabs.map((t) => t.dimension).sort()).toEqual([...PRODUCT_GRAIN_TABS].sort());
  });

  it.each(productTabs)('$key shows no order-level quantity or amount', (tab) => {
    // The actual bug: an order-level SUM selected on a tab joined to order_items.
    ORDER_LEVEL_KEYS.forEach((key) => {
      expect(tab.defaultMeasures, `${tab.key} default ${key}`).not.toContain(key);
    });
  });

  it.each(productTabs)('$key cannot even offer one in Manage Column', (tab) => {
    // availableMeasures is the only thing standing between a user and a column
    // that silently overstates. Omitting it offers every measure.
    expect(tab.availableMeasures, `${tab.key} availableMeasures`).toBeDefined();
    ORDER_LEVEL_KEYS.forEach((key) => {
      expect(tab.availableMeasures, `${tab.key} offers ${key}`).not.toContain(key);
    });
  });

  it.each(orderTabs)('$key keeps the order-level measures and is offered no twin', (tab) => {
    // The other half of the contract: this fix must not move the Customer, User,
    // Area or Period tabs, which were verified correct on prod. An item-level
    // twin here would under-report any order whose lines do not carry the
    // order's full value.
    expect(tab.availableMeasures, `${tab.key} availableMeasures`).toBeDefined();
    ITEM_LEVEL_KEYS.forEach((key) => {
      expect(tab.defaultMeasures, `${tab.key} default ${key}`).not.toContain(key);
      expect(tab.availableMeasures, `${tab.key} offers ${key}`).not.toContain(key);
    });
  });

  it('declares every key its tabs ask for', () => {
    // A key the config does not declare is a column the engine drops in silence
    // (§5i) — no error, just a column the user never sees.
    const declared = new Set(config.measures.map((m) => m.key));
    tabs.forEach((tab) => {
      [...tab.defaultMeasures, ...(tab.availableMeasures ?? [])].forEach((m) =>
        expect(declared, `${config.moduleName}/${tab.key} measure ${m}`).toContain(m)
      );
    });
  });

  it('gives each twin the same label as the measure it replaces', () => {
    // The founder chose to keep the column names (2026-10-19): the report must
    // read identically, only the arithmetic changes. Sales calls net_amount
    // "Sales Amount" where Order calls it "Amount", so this is checked per
    // config rather than against a fixed string.
    const label = (key: string) => config.measures.find((m) => m.key === key)?.label;
    Object.entries(TWINS).forEach(([orderKey, itemKey]) => {
      expect(label(itemKey), `${itemKey} label`).toBeDefined();
      expect(label(itemKey), `${itemKey} vs ${orderKey}`).toBe(label(orderKey));
    });
  });

  it('asks the engine only for twins the migration registers', () => {
    // The twins live in the DB registry, not in TypeScript. Adding a key here
    // without registering it there is the §5i silent drop again.
    config.measures
      .map((m) => m.key)
      .filter((k) => k.startsWith('item_'))
      .forEach((key) =>
        expect(migrationSql, `${key} not registered in the migration`).toContain(`'${key}'`)
      );
  });
});

describe('item-level twins are registered on `order`, once', () => {
  it('registers them under module order so sales inherits them', () => {
    // sales registers no measures of its own; module-ordered resolution
    // (['sales','order'], §5b) hands it order's rows. Registering a twin under
    // `sales` instead would fix one report and leave the other wrong.
    ITEM_LEVEL_KEYS.forEach((key) => {
      expect(migrationSql).toContain(`('order', '${key}'`);
      expect(migrationSql).not.toContain(`('sales', '${key}'`);
    });
  });

  it('leaves the order-level measures untouched', () => {
    // The Customer / User / Area / Period tabs read these and were verified
    // correct on prod. The fix adds keys; it must never UPDATE or DELETE one of
    // these, or four correct tabs break with it.
    ORDER_LEVEL_KEYS.forEach((key) => {
      expect(migrationSql).not.toContain(`('order', '${key}'`);
      expect(migrationSql).not.toMatch(
        new RegExp(`(UPDATE|DELETE)[\\s\\S]{0,400}key\\s*=\\s*'${key}'`, 'i')
      );
    });
  });
});

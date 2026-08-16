import { describe, it, expect } from 'vitest';
import {
  buildDefaultConfig,
  normalizeConfig,
  visibleItemColumns,
  MODULE_CAPABILITIES,
  DOCUMENT_MODULES,
  type DocumentTemplateConfig,
} from './schema';

describe('buildDefaultConfig', () => {
  it('produces a complete config for every module', () => {
    for (const module of DOCUMENT_MODULES) {
      const config = buildDefaultConfig(module);
      expect(config.header).toBeDefined();
      expect(config.documentInfo.rows.documentDate).toBeDefined();
      expect(config.itemTable.columns.item).toBeDefined();
      expect(config.bottomSections.signature).toBeDefined();
      expect(config.customFieldIds).toEqual([]);
    }
  });

  it('labels the date row per document type rather than always "Order Date"', () => {
    expect(buildDefaultConfig('order').documentInfo.rows.documentDate.label).toBe('Order Date');
    expect(buildDefaultConfig('payment').documentInfo.rows.documentDate.label).toBe('Payment Date');
    expect(buildDefaultConfig('dispatch').documentInfo.rows.documentDate.label).toBe('Dispatch Date');
  });

  it('never enables a row the module cannot fill', () => {
    for (const module of DOCUMENT_MODULES) {
      const config = buildDefaultConfig(module);
      const caps = MODULE_CAPABILITIES[module];
      for (const [row, toggle] of Object.entries(config.documentInfo.rows)) {
        if (toggle.enabled) {
          expect(caps.documentInfoRows).toContain(row);
        }
      }
    }
  });
});

describe('module capabilities', () => {
  it('gives a payment no item table — a receipt has one amount, not lines', () => {
    const caps = MODULE_CAPABILITIES.payment;
    expect(caps.itemTable).toBe(false);
    expect(caps.itemColumns).toHaveLength(0);
    expect(caps.totalQuantity).toBe(false);
    expect(visibleItemColumns('payment', buildDefaultConfig('payment'))).toEqual([]);
  });

  it('gives a dispatch prices, reached through its order item, but no tax column', () => {
    // dispatch_items carries no price of its own; every row links to an order item and the
    // dispatch creation screen already follows that link. The screen shows no tax, so
    // neither does the template.
    const caps = MODULE_CAPABILITIES.dispatch;
    expect(caps.itemTable).toBe(true);
    expect(caps.itemColumns).toContain('quantity');
    expect(caps.itemColumns).toContain('price');
    expect(caps.itemColumns).toContain('subAmount');
    expect(caps.itemColumns).not.toContain('tax');
    expect(caps.itemColumns).not.toContain('discount');
    expect(caps.totals).toContain('total');
  });

  it('offers every dispatch-form field in the dispatch document info rows', () => {
    // The founder's rule: a template must be able to show whatever the creation screen
    // captures. These are exactly the fields on the dispatch form.
    const rows = MODULE_CAPABILITIES.dispatch.documentInfoRows;
    for (const field of ['dispatchCode', 'invoiceNo', 'invoiceDate', 'lrNo', 'lrDate', 'transportName', 'transportContact', 'trackingNumber'] as const) {
      expect(rows).toContain(field);
    }
  });

  it('gives an order the discount columns its creation screen shows', () => {
    const caps = MODULE_CAPABILITIES.order;
    expect(caps.itemColumns).toContain('discount');
    expect(caps.itemColumns).toContain('unit');
    expect(caps.itemColumns).toContain('mrp');
    expect(caps.itemColumns).toContain('rateInclTax');
    expect(caps.totals).toContain('discount');
  });

  it('denies a quotation the discount columns, because quotation_items has none', () => {
    const caps = MODULE_CAPABILITIES.quotation;
    expect(caps.itemColumns).toContain('price');
    expect(caps.itemColumns).not.toContain('discount');
    expect(caps.itemColumns).not.toContain('mrp');
    expect(caps.totals).not.toContain('discount');
    expect(caps.documentInfoRows).toContain('validUntil');
  });

  it('turns the discount column on by default for orders', () => {
    // A document that hides a discount the customer was given invites the exact argument
    // the paperwork exists to prevent.
    expect(buildDefaultConfig('order').itemTable.columns.discount.enabled).toBe(true);
  });

  it('offers no custom fields for payments, which have none defined', () => {
    expect(MODULE_CAPABILITIES.payment.customFields).toBe(false);
  });
});

describe('normalizeConfig', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeConfig('order', null)).toEqual(buildDefaultConfig('order'));
    expect(normalizeConfig('order', 'nonsense')).toEqual(buildDefaultConfig('order'));
    expect(normalizeConfig('order', 42)).toEqual(buildDefaultConfig('order'));
  });

  it('keeps stored choices', () => {
    const stored = {
      header: { orgLogo: false },
      itemTable: { columns: { hsnCode: { enabled: true, label: 'HSN/SAC' } } },
    };
    const config = normalizeConfig('order', stored);
    expect(config.header.orgLogo).toBe(false);
    expect(config.header.orgName).toBe(true); // untouched default
    expect(config.itemTable.columns.hsnCode).toEqual({ enabled: true, label: 'HSN/SAC' });
  });

  it('fills in a field added after the template was saved', () => {
    // A template stored before the HSN column existed must not render an undefined row.
    const config = normalizeConfig('order', { itemTable: { columns: { item: { enabled: true, label: 'Product' } } } });
    expect(config.itemTable.columns.hsnCode.enabled).toBe(false);
    expect(config.itemTable.columns.hsnCode.label).toBe('HSN Code');
  });

  it('forces off anything the module cannot support', () => {
    // The exact danger case: an order config duplicated onto a payment template would
    // otherwise resurrect an item table with no items behind it.
    const orderConfig = buildDefaultConfig('order');
    const asPayment = normalizeConfig('payment', orderConfig as unknown);

    expect(asPayment.itemTable.columns.price.enabled).toBe(false);
    expect(asPayment.itemTable.columns.discount.enabled).toBe(false);
    expect(asPayment.itemTable.totals.total.enabled).toBe(false);
    expect(asPayment.bottomSections.totalQuantity.enabled).toBe(false);

    // A quotation-only row must not survive onto a payment either.
    const quotationAsPayment = normalizeConfig('payment', buildDefaultConfig('quotation') as unknown);
    expect(quotationAsPayment.documentInfo.rows.validUntil.enabled).toBe(false);
  });

  it('has no Price Group row anywhere — orders carry no price list', () => {
    // Removed 2026-08-16: the toggle existed, `orders` has no price-list column and the
    // order form has no such field, so it could only ever have printed nothing.
    for (const module of DOCUMENT_MODULES) {
      expect(Object.keys(buildDefaultConfig(module).documentInfo.rows)).not.toContain('priceGroup');
    }
  });

  it('calls the free-text row Notes, matching the order form', () => {
    expect(buildDefaultConfig('order').documentInfo.rows.notes.label).toBe('Notes');
    expect(MODULE_CAPABILITIES.order.documentInfoRows).toContain('notes');
    // Quotations have no notes column at all — terms_conditions is their free-text field.
    expect(MODULE_CAPABILITIES.quotation.documentInfoRows).not.toContain('notes');
  });

  it('strips tax and discount when an order config lands on a dispatch template', () => {
    const asDispatch = normalizeConfig('dispatch', buildDefaultConfig('order') as unknown);
    expect(asDispatch.itemTable.columns.quantity.enabled).toBe(true);
    expect(asDispatch.itemTable.columns.price.enabled).toBe(true);
    // Tax and discount are the ones a dispatch genuinely cannot fill.
    expect(asDispatch.itemTable.columns.tax.enabled).toBe(false);
    expect(asDispatch.itemTable.columns.discount.enabled).toBe(false);
    expect(visibleItemColumns('dispatch', asDispatch)).not.toContain('tax');
  });

  it('ignores a blank label rather than printing an empty column heading', () => {
    const config = normalizeConfig('order', {
      itemTable: { columns: { item: { enabled: true, label: '   ' } } },
    });
    expect(config.itemTable.columns.item.label).toBe('Item');
  });

  it('drops non-string custom field ids', () => {
    const config = normalizeConfig('order', { customFieldIds: ['a', 42, null, 'b'] } as unknown);
    expect(config.customFieldIds).toEqual(['a', 'b']);
  });

  it('round-trips a config unchanged', () => {
    for (const module of DOCUMENT_MODULES) {
      const base = buildDefaultConfig(module);
      expect(normalizeConfig(module, base as unknown as DocumentTemplateConfig)).toEqual(base);
    }
  });
});

describe('visibleItemColumns', () => {
  it('returns columns in fixed table order, not the order they were switched on', () => {
    const config = buildDefaultConfig('order');
    config.itemTable.columns.category.enabled = true;
    config.itemTable.columns.itemCode.enabled = true;
    const cols = visibleItemColumns('order', config);
    expect(cols.indexOf('itemCode')).toBeLessThan(cols.indexOf('category'));
    expect(cols.indexOf('itemNo')).toBe(0);
  });

  it('omits disabled columns', () => {
    const config = buildDefaultConfig('order');
    config.itemTable.columns.price.enabled = false;
    expect(visibleItemColumns('order', config)).not.toContain('price');
  });
});

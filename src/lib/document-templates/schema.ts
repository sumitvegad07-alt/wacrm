/**
 * Document template configuration — the single definition of what a template can contain,
 * shared by the editor, the template list and the print renderers.
 *
 * `document_templates.config` is jsonb, so Postgres will not catch a malformed template.
 * This module is the substitute: `buildDefaultConfig` produces a complete, valid config for
 * a module, and `normalizeConfig` merges anything read from the database on top of it. That
 * combination means a template saved before a section existed still renders, and a key that
 * a module cannot support is dropped rather than printed blank.
 *
 * SCOPE (2026-08-16): four document types, each with an existing print route. "Estimate"
 * from the original mockup is not a real module — the product's equivalent is Quotation.
 * "Outstanding" is not a document that exists yet.
 */

export const DOCUMENT_MODULES = ['order', 'quotation', 'dispatch', 'payment'] as const;
export type DocumentModule = (typeof DOCUMENT_MODULES)[number];

export const MODULE_LABELS: Record<DocumentModule, string> = {
  order: 'Order',
  quotation: 'Quotation',
  dispatch: 'Dispatch',
  payment: 'Payment Collection',
};

/** A section row that can be switched off and renamed by the user. */
export interface FieldToggle {
  enabled: boolean;
  label: string;
}

export interface PartyBlock {
  enabled: boolean;
  label: string;
  code: boolean;
  name: boolean;
  address: boolean;
  area: boolean;
  city: boolean;
  statePin: boolean;
  contactDetails: boolean;
  gstDetails: boolean;
}

export interface HeaderConfig {
  orgLogo: boolean;
  orgName: boolean;
  orgContact: boolean;
  orgAddress: boolean;
  orgGst: boolean;
}

/**
 * Every field a document can print beside its header.
 *
 * The governing rule, set by the founder on 2026-08-16: **a template must be able to show
 * everything its module's creation screen captures.** So the dispatch rows below are exactly
 * the fields on the dispatch form (invoice number, LR number, transport contact and the
 * rest), and a module only offers a row when it has somewhere real to read it from.
 */
export const DOCUMENT_INFO_ROWS = [
  'documentDate',
  'documentStatus',
  'validUntil',
  'notes',
  'createdBy',
  'createdByEmail',
  'createdByContact',
  'paymentType',
  'referenceNumber',
  // Dispatch — all captured on the dispatch creation form
  'dispatchCode',
  'invoiceNo',
  'invoiceDate',
  'lrNo',
  'lrDate',
  'transportName',
  'transportContact',
  'trackingNumber',
] as const;
export type DocumentInfoRow = (typeof DOCUMENT_INFO_ROWS)[number];

export interface DocumentInfoConfig {
  serialNo: boolean;
  /** The party the document is addressed to. */
  shipTo: PartyBlock;
  /** The party being billed. */
  billTo: PartyBlock;
  rows: Record<DocumentInfoRow, FieldToggle>;
}

/**
 * Item table columns, in the fixed left-to-right order they print.
 *
 * Mirrors the order creation screen, which shows: Product · Unit · Qty · Price ·
 * Rate incl. tax · Line total incl. · Discount · Tax · Line Total, with the catalogue price
 * struck through above a discounted rate. The original template offered none of the
 * discount or tax-inclusive columns, which is what the founder caught.
 */
export const ITEM_COLUMNS = [
  'itemNo',
  'image',
  'itemCode',
  'hsnCode',
  'category',
  'item',
  'unit',
  'quantity',
  'mrp',
  'price',
  'discount',
  'tax',
  'rateInclTax',
  'subAmount',
  'netAmount',
] as const;
export type ItemColumn = (typeof ITEM_COLUMNS)[number];
// The order screen shows both "Line total incl." and "Line Total". Once the line's tax mode
// is applied those are the same figure, so the template offers it once, as Net Amount —
// two columns printing an identical number on every row is worse than one.

export const TOTAL_ROWS = ['subTotal', 'discount', 'taxSummary', 'total'] as const;
export type TotalRow = (typeof TOTAL_ROWS)[number];

export interface ItemTableConfig {
  columns: Record<ItemColumn, FieldToggle>;
  totals: Record<TotalRow, FieldToggle>;
}

export interface SignatureConfig {
  enabled: boolean;
  label: string;
  name: string;
  image: boolean;
  attachmentUrl: string;
}

export interface BottomSectionsConfig {
  totalQuantity: FieldToggle;
  signature: SignatureConfig;
  additionalSignature: { enabled: boolean; label: string; name: string };
  footer: { enabled: boolean; text: string };
}

export interface DocumentTemplateConfig {
  header: HeaderConfig;
  documentInfo: DocumentInfoConfig;
  itemTable: ItemTableConfig;
  bottomSections: BottomSectionsConfig;
  /**
   * Custom-field ids to print, from the module's own `custom_fields` catalogue. Stored as
   * ids rather than names so renaming a field in Settings does not silently drop it from
   * every document.
   */
  customFieldIds: string[];
}

/**
 * What each document type can actually fill from real data.
 *
 * This is the "show only what applies" rule, decided 2026-08-16, and it is data rather than
 * conditionals scattered through the editor. Two hard constraints drive it:
 *
 *  - A payment has no line items. `payments` is a single row with an amount; there is no
 *    items table to render, so the whole item table and the total-quantity summary are out.
 *  - A quotation has no discount. `quotation_items` carries product, unit, quantity, price,
 *    tax and totals — and no discount columns at all — so a quotation template cannot offer
 *    one. Same rule as everywhere else, not an inconsistency with orders.
 *  - A dispatch DOES have money, contrary to an earlier reading of this file.
 *    `dispatch_items` stores no price of its own, but every row carries `order_item_id` and
 *    the dispatch creation screen already shows Price and Sub Total by following it. All
 *    dispatch lines in production are linked, so the join is safe. It has no tax column,
 *    because the dispatch screen does not show one.
 */
export interface ModuleCapabilities {
  itemTable: boolean;
  itemColumns: readonly ItemColumn[];
  totals: readonly TotalRow[];
  documentInfoRows: readonly DocumentInfoRow[];
  totalQuantity: boolean;
  /** Whether the module has a `custom_fields` catalogue worth offering. */
  customFields: boolean;
}

/** Catalogue extras that come from `products`, available to any module with line items. */
const PRODUCT_COLUMNS = ['itemNo', 'image', 'itemCode', 'hsnCode', 'category', 'item'] as const;

export const MODULE_CAPABILITIES: Record<DocumentModule, ModuleCapabilities> = {
  order: {
    // The full order screen: discount, tax mode and the struck-through catalogue price.
    itemTable: true,
    itemColumns: ITEM_COLUMNS,
    totals: TOTAL_ROWS,
    documentInfoRows: ['documentDate', 'documentStatus', 'notes', 'createdBy', 'createdByEmail', 'createdByContact'],
    totalQuantity: true,
    customFields: true,
  },
  quotation: {
    // `quotation_items` has no discount and no catalogue price, and the quotation screen
    // shows no tax-inclusive rate, so those four columns are genuinely unavailable here.
    itemTable: true,
    itemColumns: [...PRODUCT_COLUMNS, 'unit', 'quantity', 'price', 'tax', 'subAmount', 'netAmount'],
    totals: ['subTotal', 'taxSummary', 'total'],
    // No `notes` row: the quotations table has no notes column — terms_conditions is the
    // free-text field, and that already drives the footer.
    documentInfoRows: ['documentDate', 'documentStatus', 'validUntil', 'createdBy', 'createdByEmail', 'createdByContact'],
    totalQuantity: true,
    customFields: true,
  },
  dispatch: {
    // Prices reached through dispatch_items.order_item_id, exactly as the dispatch creation
    // screen does. No tax column, because that screen has none.
    itemTable: true,
    itemColumns: [...PRODUCT_COLUMNS, 'unit', 'quantity', 'price', 'subAmount'],
    totals: ['subTotal', 'total'],
    documentInfoRows: [
      'documentDate', 'dispatchCode', 'invoiceNo', 'invoiceDate', 'lrNo', 'lrDate',
      'transportName', 'transportContact', 'trackingNumber', 'notes',
      'createdBy', 'createdByEmail', 'createdByContact',
    ],
    totalQuantity: true,
    customFields: true,
  },
  payment: {
    // A receipt for a single amount. There is nothing to tabulate.
    itemTable: false,
    itemColumns: [],
    totals: [],
    documentInfoRows: ['documentDate', 'documentStatus', 'paymentType', 'referenceNumber', 'notes', 'createdBy', 'createdByEmail', 'createdByContact'],
    totalQuantity: false,
    // `custom_fields` has 0 rows for the payment module, so the section would be empty.
    customFields: false,
  },
};

/** Default row labels, per module, so a payment does not say "Order Date". */
const DOCUMENT_INFO_LABELS: Record<DocumentModule, Partial<Record<DocumentInfoRow, string>>> = {
  order: { documentDate: 'Order Date', documentStatus: 'Order Status' },
  quotation: { documentDate: 'Quotation Date', documentStatus: 'Status' },
  dispatch: { documentDate: 'Dispatch Date' },
  payment: { documentDate: 'Payment Date', documentStatus: 'Status' },
};

const BASE_DOCUMENT_INFO_LABELS: Record<DocumentInfoRow, string> = {
  documentDate: 'Date',
  documentStatus: 'Status',
  validUntil: 'Valid Until',
  notes: 'Notes',
  createdBy: 'Created By',
  createdByEmail: 'Email',
  createdByContact: 'Contact No',
  paymentType: 'Payment Mode',
  referenceNumber: 'Reference No',
  dispatchCode: 'Dispatch Code',
  invoiceNo: 'Invoice No',
  invoiceDate: 'Invoice Date',
  lrNo: 'LR No',
  lrDate: 'LR Date',
  transportName: 'Transport',
  transportContact: 'Transport Contact',
  trackingNumber: 'Tracking No',
};

const ITEM_COLUMN_LABELS: Record<ItemColumn, string> = {
  itemNo: '#',
  image: 'Image',
  itemCode: 'Item Code',
  hsnCode: 'HSN Code',
  category: 'Category',
  item: 'Item',
  unit: 'Unit',
  quantity: 'Quantity',
  mrp: 'MRP',
  price: 'Price',
  discount: 'Discount',
  tax: 'Tax',
  rateInclTax: 'Rate incl. Tax',
  subAmount: 'Sub Amount',
  netAmount: 'Net Amount',
};

const TOTAL_ROW_LABELS: Record<TotalRow, string> = {
  subTotal: 'Sub Total',
  discount: 'Discount',
  taxSummary: 'Tax',
  total: 'Total',
};

/**
 * Columns on by default. The rest exist but start hidden — a document that printed all
 * sixteen columns out of the box would be unreadable on A4.
 *
 * `discount` is on: an order that gave a customer a discount and then prints without showing
 * it invites the exact argument the document is meant to prevent.
 */
const DEFAULT_ON_COLUMNS: ReadonlySet<ItemColumn> = new Set<ItemColumn>([
  'itemNo', 'item', 'unit', 'quantity', 'price', 'discount', 'tax', 'subAmount', 'netAmount',
]);

const DEFAULT_ON_INFO_ROWS: ReadonlySet<DocumentInfoRow> = new Set<DocumentInfoRow>([
  'documentDate', 'documentStatus', 'validUntil', 'createdBy', 'paymentType', 'referenceNumber',
  'dispatchCode', 'invoiceNo', 'lrNo', 'transportName',
]);

function defaultPartyBlock(label: string, enabled: boolean): PartyBlock {
  return {
    enabled,
    label,
    code: true,
    name: true,
    address: true,
    area: false,
    city: true,
    statePin: true,
    contactDetails: true,
    gstDetails: true,
  };
}

export function buildDefaultConfig(module: DocumentModule): DocumentTemplateConfig {
  const caps = MODULE_CAPABILITIES[module];

  const rows = {} as Record<DocumentInfoRow, FieldToggle>;
  for (const row of DOCUMENT_INFO_ROWS) {
    rows[row] = {
      enabled: caps.documentInfoRows.includes(row) && DEFAULT_ON_INFO_ROWS.has(row),
      label: DOCUMENT_INFO_LABELS[module][row] ?? BASE_DOCUMENT_INFO_LABELS[row],
    };
  }

  const columns = {} as Record<ItemColumn, FieldToggle>;
  for (const col of ITEM_COLUMNS) {
    columns[col] = {
      enabled: caps.itemColumns.includes(col) && DEFAULT_ON_COLUMNS.has(col),
      label: ITEM_COLUMN_LABELS[col],
    };
  }

  const totals = {} as Record<TotalRow, FieldToggle>;
  for (const row of TOTAL_ROWS) {
    totals[row] = { enabled: caps.totals.includes(row), label: TOTAL_ROW_LABELS[row] };
  }

  return {
    header: { orgLogo: true, orgName: true, orgContact: true, orgAddress: true, orgGst: true },
    documentInfo: {
      serialNo: true,
      // A dispatch goes to a delivery address and a payment is a receipt for one party, so
      // only the sales documents show both blocks by default.
      shipTo: defaultPartyBlock(module === 'dispatch' ? 'Deliver To' : 'Ship To', module !== 'payment'),
      billTo: defaultPartyBlock(module === 'payment' ? 'Received From' : 'Bill To', true),
      rows,
    },
    itemTable: { columns, totals },
    bottomSections: {
      totalQuantity: { enabled: caps.totalQuantity, label: 'Total Quantity' },
      signature: {
        enabled: true,
        label: 'Authorised Signature',
        name: '',
        image: false,
        attachmentUrl: '',
      },
      additionalSignature: {
        enabled: module !== 'payment',
        label: "Receiver's Signature",
        name: '',
      },
      footer: { enabled: false, text: '' },
    },
    customFieldIds: [],
  };
}

/**
 * Merge a stored config over the module defaults.
 *
 * Two jobs, both about surviving change:
 *  - a template saved before a field existed gets the new field's default rather than
 *    `undefined`, which would render as a blank row;
 *  - anything the module cannot support is forced off, so a config copied from an order
 *    template into a payment template cannot resurrect an item table with no items behind it.
 */
export function normalizeConfig(module: DocumentModule, raw: unknown): DocumentTemplateConfig {
  const base = buildDefaultConfig(module);
  if (!raw || typeof raw !== 'object') return base;

  const stored = raw as Partial<DocumentTemplateConfig>;
  const caps = MODULE_CAPABILITIES[module];

  const mergeToggle = (fallback: FieldToggle, value: unknown, supported: boolean): FieldToggle => {
    if (!supported) return { ...fallback, enabled: false };
    if (!value || typeof value !== 'object') return fallback;
    const v = value as Partial<FieldToggle>;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled,
      label: typeof v.label === 'string' && v.label.trim() !== '' ? v.label : fallback.label,
    };
  };

  const mergeParty = (fallback: PartyBlock, value: unknown): PartyBlock => {
    if (!value || typeof value !== 'object') return fallback;
    const v = value as Partial<PartyBlock>;
    const bool = (k: keyof PartyBlock) =>
      typeof v[k] === 'boolean' ? (v[k] as boolean) : (fallback[k] as boolean);
    return {
      enabled: bool('enabled'),
      label: typeof v.label === 'string' && v.label.trim() !== '' ? v.label : fallback.label,
      code: bool('code'),
      name: bool('name'),
      address: bool('address'),
      area: bool('area'),
      city: bool('city'),
      statePin: bool('statePin'),
      contactDetails: bool('contactDetails'),
      gstDetails: bool('gstDetails'),
    };
  };

  const rows = {} as Record<DocumentInfoRow, FieldToggle>;
  for (const row of DOCUMENT_INFO_ROWS) {
    rows[row] = mergeToggle(
      base.documentInfo.rows[row],
      stored.documentInfo?.rows?.[row],
      caps.documentInfoRows.includes(row)
    );
  }

  const columns = {} as Record<ItemColumn, FieldToggle>;
  for (const col of ITEM_COLUMNS) {
    columns[col] = mergeToggle(
      base.itemTable.columns[col],
      stored.itemTable?.columns?.[col],
      caps.itemTable && caps.itemColumns.includes(col)
    );
  }

  const totals = {} as Record<TotalRow, FieldToggle>;
  for (const row of TOTAL_ROWS) {
    totals[row] = mergeToggle(
      base.itemTable.totals[row],
      stored.itemTable?.totals?.[row],
      caps.totals.includes(row)
    );
  }

  const storedSig = stored.bottomSections?.signature;
  const storedAdd = stored.bottomSections?.additionalSignature;
  const storedFooter = stored.bottomSections?.footer;

  return {
    header: { ...base.header, ...(stored.header ?? {}) },
    documentInfo: {
      serialNo:
        typeof stored.documentInfo?.serialNo === 'boolean'
          ? stored.documentInfo.serialNo
          : base.documentInfo.serialNo,
      shipTo: mergeParty(base.documentInfo.shipTo, stored.documentInfo?.shipTo),
      billTo: mergeParty(base.documentInfo.billTo, stored.documentInfo?.billTo),
      rows,
    },
    itemTable: { columns, totals },
    bottomSections: {
      totalQuantity: mergeToggle(
        base.bottomSections.totalQuantity,
        stored.bottomSections?.totalQuantity,
        caps.totalQuantity
      ),
      signature: {
        enabled: storedSig?.enabled ?? base.bottomSections.signature.enabled,
        label: storedSig?.label || base.bottomSections.signature.label,
        name: storedSig?.name ?? base.bottomSections.signature.name,
        image: storedSig?.image ?? base.bottomSections.signature.image,
        attachmentUrl: storedSig?.attachmentUrl ?? base.bottomSections.signature.attachmentUrl,
      },
      additionalSignature: {
        enabled: storedAdd?.enabled ?? base.bottomSections.additionalSignature.enabled,
        label: storedAdd?.label || base.bottomSections.additionalSignature.label,
        name: storedAdd?.name ?? base.bottomSections.additionalSignature.name,
      },
      footer: {
        enabled: storedFooter?.enabled ?? base.bottomSections.footer.enabled,
        text: storedFooter?.text ?? base.bottomSections.footer.text,
      },
    },
    customFieldIds: Array.isArray(stored.customFieldIds)
      ? stored.customFieldIds.filter((id): id is string => typeof id === 'string')
      : base.customFieldIds,
  };
}

/** Columns to render, in the fixed order they appear in the table. */
export function visibleItemColumns(
  module: DocumentModule,
  config: DocumentTemplateConfig
): ItemColumn[] {
  const caps = MODULE_CAPABILITIES[module];
  if (!caps.itemTable) return [];
  return ITEM_COLUMNS.filter(
    (col) => caps.itemColumns.includes(col) && config.itemTable.columns[col].enabled
  );
}

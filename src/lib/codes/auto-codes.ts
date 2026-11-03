/**
 * Automatic codes for the master records — Customer, Employee, Product.
 *
 * Founder, 2026-11-03: "Customer code, employee code ... all the codes should be
 * generated automatically, but we need to provide an option in organisation
 * settings. If they enable it they can generate those codes automatically. By
 * default it must be disabled." Lead code was dropped on his instruction the
 * same day — leads have no code column and are not getting one.
 *
 * OZZO already numbers its DOCUMENTS this way: account_sequences holds nine
 * counters (order, quotation, payment, dispatch, expense, job, leave, deal,
 * asset) and each has a get_next_*_number() function plus a BEFORE INSERT
 * trigger. The MASTER records were never numbered — customer_code,
 * employee_code and products.sku are all typed by hand today.
 *
 * One difference from that existing numbering must not be missed: it is
 * unconditional. This is per-account, per-record-type, and OFF until an admin
 * turns it on, so no live tenant's data changes until they ask.
 *
 * This module is the shared vocabulary only — the shape of the setting, the
 * clamping, and the preview string. The authoritative generator is
 * `next_generated_code()` in the database (20261103130000), because a code has
 * to be unique under two people pressing Save at the same moment and only the
 * database can promise that. `formatCode` here must agree with the SQL
 * character for character; its test asserts the same cases the SQL test does.
 */

export const CODE_KINDS = ['customer', 'employee', 'product'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

export interface CodeRule {
  /** Off by default, per record type. */
  enabled: boolean;
  /** Leading text, e.g. "CUST-". May be empty. */
  prefix: string;
  /** Zero-padded width of the number, 1–10. */
  digits: number;
  /** The number the next generated code will use. */
  next: number;
}

export type CodeSettings = Record<CodeKind, CodeRule>;

export const MIN_DIGITS = 1;
export const MAX_DIGITS = 10;
export const MAX_PREFIX_LENGTH = 12;

/** What each record type is called, and which column the code lands in. */
export const CODE_KIND_META: Record<
  CodeKind,
  { label: string; field: string; defaultPrefix: string; help: string }
> = {
  customer: {
    label: 'Customer',
    field: 'Customer Code',
    defaultPrefix: 'CUST-',
    help: 'Filled in when a customer is saved with the Customer Code box left empty.',
  },
  employee: {
    label: 'Employee',
    field: 'Employee Code',
    defaultPrefix: 'EMP-',
    help: 'Filled in when an employee is added with the Employee Code box left empty.',
  },
  product: {
    label: 'Product',
    field: 'Product Code',
    defaultPrefix: 'SKU-',
    help: 'Filled in when a product is saved with the Product Code box left empty. Leave this off if your product codes carry meaning, such as size or pack.',
  },
};

export const DEFAULT_CODE_SETTINGS: CodeSettings = {
  customer: { enabled: false, prefix: 'CUST-', digits: 4, next: 1 },
  employee: { enabled: false, prefix: 'EMP-', digits: 4, next: 1 },
  product: { enabled: false, prefix: 'SKU-', digits: 4, next: 1 },
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * A prefix is free text, but not anything at all: whitespace inside a code is
 * the kind of thing that breaks a CSV export or a Tally import weeks later, and
 * a quote mark breaks a hand-written SQL report.
 */
export function cleanPrefix(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^A-Za-z0-9/_-]/g, '')
    .slice(0, MAX_PREFIX_LENGTH);
}

/** One rule, with anything missing or out of range brought back in. */
export function normalizeRule(raw: unknown, kind: CodeKind): CodeRule {
  const fallback = DEFAULT_CODE_SETTINGS[kind];
  const r = (raw ?? {}) as Partial<Record<keyof CodeRule, unknown>>;
  const prefix = r.prefix === undefined ? fallback.prefix : cleanPrefix(r.prefix);
  return {
    enabled: r.enabled === true,
    prefix,
    digits: clampInt(r.digits, MIN_DIGITS, MAX_DIGITS, fallback.digits),
    // Never below 1: a sequence that starts at 0 produces "CUST-0000", which
    // reads like a missing value rather than the first customer.
    next: clampInt(r.next, 1, Number.MAX_SAFE_INTEGER, fallback.next),
  };
}

/** Reads `accounts.settings.code_settings`, whatever state it is in. */
export function readCodeSettings(accountSettings: unknown): CodeSettings {
  const raw = (accountSettings as { code_settings?: unknown } | null | undefined)?.code_settings;
  const bag = (raw ?? {}) as Record<string, unknown>;
  return CODE_KINDS.reduce((out, kind) => {
    out[kind] = normalizeRule(bag[kind], kind);
    return out;
  }, {} as CodeSettings);
}

/**
 * The code a given sequence number produces. Must match the SQL's
 * `prefix || lpad(seq::text, digits, '0')` exactly.
 *
 * A number wider than `digits` is NOT truncated — it simply grows. Cutting it
 * would mint a duplicate on the ten-thousandth customer, which is the worst
 * possible moment to find out.
 */
export function formatCode(rule: Pick<CodeRule, 'prefix' | 'digits'>, seq: number): string {
  const n = Math.max(1, Math.trunc(seq));
  return `${rule.prefix}${String(n).padStart(rule.digits, '0')}`;
}

/** What the admin sees beside the row while editing it. */
export function previewCode(rule: CodeRule): string {
  return formatCode(rule, rule.next);
}

/** True when this record type should be numbered on save. */
export function isAutoCodeOn(accountSettings: unknown, kind: CodeKind): boolean {
  return readCodeSettings(accountSettings)[kind].enabled;
}

/**
 * Placeholder for the code box on a form: shows what will be generated if the
 * box is left empty, so nobody wonders whether a blank is allowed.
 */
export function codePlaceholder(accountSettings: unknown, kind: CodeKind): string {
  const rule = readCodeSettings(accountSettings)[kind];
  if (!rule.enabled) return '';
  return `Auto (${previewCode(rule)})`;
}

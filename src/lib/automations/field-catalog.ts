// ------------------------------------------------------------
// Field catalog for module automations.
//
// Drives the Conditions "Field" dropdown and the WhatsApp template variable
// mapper. Fields come from two places:
//
//   1. SYSTEM FIELDS — the real columns on contacts / orders / order_dispatches.
//      These are whitelisted here, by hand, and cross-checked against the
//      `custom_fields` registry for their admin-facing label.
//
//   2. CUSTOM FIELDS — rows in `custom_fields` with source_type = 'module',
//      exposed as `custom:<uuid>` and resolved from the *_custom_values tables.
//
// WHY THE WHITELIST EXISTS, AND WHY IT IS NOT OPTIONAL:
// `custom_fields` already registers system fields per module with a
// `system_key` (verified in production: 123 rows for contact, 34 for order,
// 32 for dispatch). It looks like a ready-made catalog. It is not trustworthy
// on its own — live inspection found registered keys with no matching column
// at all: contact.type, contact.status, order.valid_until, order.delivery_date,
// order.payment_terms. It also holds two separate "Order Date" entries
// (order_date and date).
//
// If those reached the dropdown, an admin would build a condition on
// "Delivery Date", it would resolve to undefined on every single order, the
// rule would quietly never match, and the automation would look broken with
// nothing in the logs to explain it. So the registry supplies labels; this
// file decides what actually exists.
// ------------------------------------------------------------

import { ORDER_STATUSES } from '@/lib/orders/statuses'

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'phone'
  | 'email'
  | 'boolean'

export type CatalogGroupKey = 'customer' | 'order' | 'dispatch'

export type AutomationModule = 'customer' | 'order' | 'dispatch'

export type AutomationEventType =
  | 'customer_created'
  | 'order_created'
  | 'order_status_changed'
  | 'dispatch_created'

export interface CatalogField {
  /** Fully-qualified key used in rules and variable mappings. */
  key: string
  /** Column name (system) or `custom:<uuid>` (custom). */
  field: string
  label: string
  type: FieldType
  group: CatalogGroupKey
  isCustom: boolean
  options?: string[]
}

export interface CatalogGroup {
  key: CatalogGroupKey
  label: string
  fields: CatalogField[]
}

interface WhitelistEntry {
  column: string
  label: string
  type: FieldType
}

// ------------------------------------------------------------
// System field whitelists — every entry verified against the live schema.
// ------------------------------------------------------------

const CUSTOMER_FIELDS: WhitelistEntry[] = [
  { column: 'name', label: 'Contact Person', type: 'text' },
  { column: 'company', label: 'Company', type: 'text' },
  { column: 'phone', label: 'Phone', type: 'phone' },
  { column: 'email', label: 'Email', type: 'email' },
  { column: 'address', label: 'Street Address', type: 'text' },
  { column: 'area', label: 'Area / Locality', type: 'text' },
  { column: 'city', label: 'City', type: 'text' },
  { column: 'state', label: 'State', type: 'text' },
  { column: 'country', label: 'Country', type: 'text' },
  { column: 'pincode', label: 'Pincode / ZIP', type: 'text' },
  { column: 'hierarchy_level', label: 'Customer Level', type: 'number' },
  { column: 'created_at', label: 'Created On', type: 'date' },
]

const ORDER_FIELDS: WhitelistEntry[] = [
  { column: 'order_number', label: 'Order Number', type: 'text' },
  { column: 'date', label: 'Order Date', type: 'date' },
  { column: 'status', label: 'Order Status', type: 'select' },
  { column: 'classification', label: 'Classification', type: 'select' },
  { column: 'total_amount', label: 'Order Total', type: 'number' },
  { column: 'sub_total', label: 'Sub Total', type: 'number' },
  { column: 'tax_total', label: 'Tax Total', type: 'number' },
  { column: 'discount_total', label: 'Discount Total', type: 'number' },
  { column: 'pricing_status', label: 'Pricing Status', type: 'select' },
  { column: 'notes', label: 'Notes', type: 'text' },
  { column: 'created_at', label: 'Created On', type: 'date' },
]

const DISPATCH_FIELDS: WhitelistEntry[] = [
  { column: 'dispatch_number', label: 'Dispatch Number', type: 'text' },
  { column: 'dispatched_at', label: 'Dispatch Date', type: 'date' },
  { column: 'transport_name', label: 'Transport Name', type: 'text' },
  { column: 'transport_contact_no', label: 'Transport Contact No', type: 'phone' },
  { column: 'tracking_number', label: 'Tracking Number', type: 'text' },
  { column: 'lr_no', label: 'LR Number', type: 'text' },
  { column: 'lr_date', label: 'LR Date', type: 'date' },
  { column: 'invoice_no', label: 'Invoice Number', type: 'text' },
  { column: 'invoice_date', label: 'Invoice Date', type: 'date' },
  { column: 'notes', label: 'Notes', type: 'text' },
  { column: 'created_at', label: 'Created On', type: 'date' },
]

export const SYSTEM_FIELD_WHITELIST: Record<CatalogGroupKey, WhitelistEntry[]> = {
  customer: CUSTOMER_FIELDS,
  order: ORDER_FIELDS,
  dispatch: DISPATCH_FIELDS,
}

/**
 * Which record groups are reachable from each module.
 *
 * Order and Dispatch events expose the customer's fields too — this is not a
 * nicety, it is required by the primary use case: "send on new order, but only
 * for customers in Gujarat" filters an Order event on `customer.state`.
 */
export const MODULE_GROUPS: Record<AutomationModule, CatalogGroupKey[]> = {
  customer: ['customer'],
  order: ['order', 'customer'],
  dispatch: ['dispatch', 'order', 'customer'],
}

export const GROUP_LABELS: Record<CatalogGroupKey, string> = {
  customer: 'Customer fields',
  order: 'Order fields',
  dispatch: 'Dispatch fields',
}

/** `custom_fields.module_name` uses 'contact', the rest of this module says 'customer'. */
export const GROUP_TO_CUSTOM_FIELD_MODULE: Record<CatalogGroupKey, string> = {
  customer: 'contact',
  order: 'order',
  dispatch: 'dispatch',
}

export const MODULE_EVENTS: Record<AutomationModule, AutomationEventType[]> = {
  customer: ['customer_created'],
  order: ['order_created', 'order_status_changed'],
  dispatch: ['dispatch_created'],
}

export const EVENT_LABELS: Record<AutomationEventType, string> = {
  customer_created: 'Customer created',
  order_created: 'Order created',
  order_status_changed: 'Order status changed',
  dispatch_created: 'Dispatch created',
}

export const EVENT_MODULE: Record<AutomationEventType, AutomationModule> = {
  customer_created: 'customer',
  order_created: 'order',
  order_status_changed: 'order',
  dispatch_created: 'dispatch',
}

// ------------------------------------------------------------
// Catalog assembly
// ------------------------------------------------------------

export interface CustomFieldRow {
  id: string
  field_name: string
  field_type: string | null
  module_name: string | null
  source_type: string | null
  system_key: string | null
  is_active: boolean | null
  field_options: unknown
}

export interface BuildCatalogResult {
  groups: CatalogGroup[]
  /**
   * Registered `system_key`s that were dropped because no such column exists.
   * Logged once by the API route so the registry drift stays visible instead
   * of turning into a mysteriously missing dropdown entry.
   */
  omittedSystemKeys: string[]
}

function normalizeFieldType(raw: string | null | undefined): FieldType {
  switch ((raw ?? '').toLowerCase()) {
    case 'number':
    case 'numeric':
    case 'integer':
    case 'decimal':
      return 'number'
    case 'date':
    case 'datetime':
    case 'timestamp':
      return 'date'
    case 'select':
    case 'dropdown':
    case 'multiselect':
      return 'select'
    case 'phone':
      return 'phone'
    case 'email':
      return 'email'
    case 'boolean':
    case 'checkbox':
      return 'boolean'
    default:
      return 'text'
  }
}

function parseOptions(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const out = raw
      .map((o) => {
        if (typeof o === 'string') return o
        if (o && typeof o === 'object' && 'label' in o) return String((o as { label: unknown }).label)
        if (o && typeof o === 'object' && 'value' in o) return String((o as { value: unknown }).value)
        return null
      })
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    return out.length > 0 ? out : undefined
  }
  return undefined
}

/**
 * Build the catalog for a module.
 *
 * `customFields` is the raw `custom_fields` rows for the account. System
 * entries are matched by `system_key` purely to pick up the admin's preferred
 * label; an unmatched whitelist entry still appears, using its built-in label.
 * A registry entry with no whitelist match is dropped and reported.
 */
export function buildFieldCatalog(
  module: AutomationModule,
  customFields: CustomFieldRow[],
  statusOptions?: { order?: string[] },
): BuildCatalogResult {
  const groups: CatalogGroup[] = []
  const omittedSystemKeys: string[] = []

  for (const groupKey of MODULE_GROUPS[module]) {
    const registryModule = GROUP_TO_CUSTOM_FIELD_MODULE[groupKey]
    const rowsForGroup = customFields.filter(
      (f) => f.module_name === registryModule && f.is_active !== false,
    )

    // Registry labels, keyed by system_key, for the whitelist to borrow.
    const labelBySystemKey = new Map<string, string>()
    for (const row of rowsForGroup) {
      if (row.system_key && !labelBySystemKey.has(row.system_key)) {
        labelBySystemKey.set(row.system_key, row.field_name)
      }
    }

    const whitelist = SYSTEM_FIELD_WHITELIST[groupKey]
    const whitelistColumns = new Set(whitelist.map((w) => w.column))

    const fields: CatalogField[] = whitelist.map((entry) => {
      const field: CatalogField = {
        key: `${groupKey}.${entry.column}`,
        field: entry.column,
        label: labelBySystemKey.get(entry.column) ?? entry.label,
        type: entry.type,
        group: groupKey,
        isCustom: false,
      }
      if (groupKey === 'order' && entry.column === 'status') {
        // The status choices come from the enforced state machine, never from a
        // settings table. The old configurable `order_statuses` list had drifted
        // to names the machine did not recognise (Placed/Accepted), so an
        // automation built on it would have matched nothing, forever.
        field.options = statusOptions?.order?.length
          ? statusOptions.order
          : [...ORDER_STATUSES]
      }
      return field
    })

    // Report registry drift: a system_key that claims to be a real column but
    // is not on the whitelist.
    for (const row of rowsForGroup) {
      if (row.system_key && !whitelistColumns.has(row.system_key)) {
        omittedSystemKeys.push(`${registryModule}.${row.system_key}`)
      }
    }

    // Genuine custom fields defined by the admin.
    for (const row of rowsForGroup) {
      if (row.source_type !== 'module') continue
      fields.push({
        key: `${groupKey}.custom:${row.id}`,
        field: `custom:${row.id}`,
        label: row.field_name,
        type: normalizeFieldType(row.field_type),
        group: groupKey,
        isCustom: true,
        options: parseOptions(row.field_options),
      })
    }

    groups.push({ key: groupKey, label: GROUP_LABELS[groupKey], fields })
  }

  return { groups, omittedSystemKeys: [...new Set(omittedSystemKeys)].sort() }
}

/** Flat lookup of key → type, for the numeric/date coercion in condition-eval. */
export function fieldTypeMap(groups: CatalogGroup[]): Map<string, FieldType> {
  const map = new Map<string, FieldType>()
  for (const g of groups) {
    for (const f of g.fields) map.set(f.key, f.type)
  }
  return map
}

/** True when the key is one the catalog actually offers — used by activation validation. */
export function isKnownField(groups: CatalogGroup[], key: string): boolean {
  return groups.some((g) => g.fields.some((f) => f.key === key))
}

export function findField(groups: CatalogGroup[], key: string): CatalogField | undefined {
  for (const g of groups) {
    const hit = g.fields.find((f) => f.key === key)
    if (hit) return hit
  }
  return undefined
}

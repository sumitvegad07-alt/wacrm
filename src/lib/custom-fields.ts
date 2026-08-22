import React from 'react';
import type { ColumnDef, ColumnFilterType } from '@/components/ui/data-table/data-table-types';
import type { CustomField, CustomFieldSection } from '@/types';

export interface DefaultSectionDefinition {
  name: string;
  position: number;
  fields: {
    system_key: string;
    field_name: string;
    field_type: string;
    is_required: boolean;
    show_in_table: boolean;
    is_sortable?: boolean;
    is_filterable?: boolean;
    position: number;
  }[];
}

export const DEFAULT_MODULE_SECTIONS_AND_FIELDS: Record<string, DefaultSectionDefinition[]> = {
  contact: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'company', field_name: 'Company Name', field_type: 'text', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'name', field_name: 'Contact Person', field_type: 'text', is_required: true, show_in_table: true, position: 1 },
        { system_key: 'phone', field_name: 'Phone Number', field_type: 'phone', is_required: true, show_in_table: true, position: 2 },
        { system_key: 'whatsapp', field_name: 'WhatsApp Number', field_type: 'phone', is_required: false, show_in_table: true, position: 3 },
        { system_key: 'email', field_name: 'Email Address', field_type: 'email', is_required: false, show_in_table: true, position: 4 },
        { system_key: 'hierarchy_level', field_name: 'Customer Level', field_type: 'select', is_required: false, show_in_table: true, position: 5 },
      ],
    },
    {
      name: 'Address Details',
      position: 10,
      fields: [
        { system_key: 'address', field_name: 'Street Address', field_type: 'text', is_required: false, show_in_table: false, position: 0 },
        { system_key: 'area', field_name: 'Area / Locality', field_type: 'text', is_required: false, show_in_table: false, position: 1 },
        { system_key: 'city', field_name: 'City', field_type: 'text', is_required: false, show_in_table: true, position: 2 },
        { system_key: 'state', field_name: 'State', field_type: 'text', is_required: false, show_in_table: false, position: 3 },
        { system_key: 'country', field_name: 'Country', field_type: 'text', is_required: false, show_in_table: false, position: 4 },
        { system_key: 'pincode', field_name: 'Pincode / ZIP', field_type: 'text', is_required: false, show_in_table: false, position: 5 },
      ],
    },
  ],
  lead: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'name', field_name: 'Business / Lead Name', field_type: 'text', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'contact_person', field_name: 'Contact Person', field_type: 'text', is_required: true, show_in_table: true, position: 1 },
        { system_key: 'whatsapp', field_name: 'WhatsApp Number', field_type: 'phone', is_required: false, show_in_table: true, position: 2 },
        { system_key: 'email', field_name: 'Email Address', field_type: 'email', is_required: false, show_in_table: true, position: 3 },
      ],
    },
    {
      name: 'Lead Status & Source',
      position: 10,
      fields: [
        { system_key: 'status', field_name: 'Lead Status', field_type: 'select', is_required: false, show_in_table: true, position: 0 },
        { system_key: 'source', field_name: 'Source', field_type: 'select', is_required: false, show_in_table: true, position: 1 },
        { system_key: 'industry', field_name: 'Industry', field_type: 'select', is_required: false, show_in_table: true, position: 2 },
      ],
    },
    {
      name: 'Address Details',
      position: 20,
      fields: [
        { system_key: 'address', field_name: 'Address', field_type: 'text', is_required: false, show_in_table: false, position: 0 },
        { system_key: 'city', field_name: 'City', field_type: 'text', is_required: false, show_in_table: false, position: 1 },
        { system_key: 'state', field_name: 'State', field_type: 'text', is_required: false, show_in_table: false, position: 2 },
        { system_key: 'country', field_name: 'Country', field_type: 'text', is_required: false, show_in_table: false, position: 3 },
      ],
    },
  ],
  product: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'name', field_name: 'Product Name', field_type: 'text', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'sku', field_name: 'SKU', field_type: 'text', is_required: false, show_in_table: true, position: 1 },
        { system_key: 'category', field_name: 'Category', field_type: 'text', is_required: false, show_in_table: true, position: 2 },
        { system_key: 'unit', field_name: 'Unit', field_type: 'text', is_required: false, show_in_table: true, position: 3 },
      ],
    },
    {
      name: 'Pricing & Inventory',
      position: 10,
      fields: [
        { system_key: 'price', field_name: 'Price', field_type: 'number', is_required: true, show_in_table: true, position: 0 },
      ],
    },
  ],
  deal: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'title', field_name: 'Title', field_type: 'text', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'value', field_name: 'Value', field_type: 'number', is_required: true, show_in_table: true, position: 1 },
      ],
    },
    {
      name: 'Timeline & Stage',
      position: 10,
      fields: [
        { system_key: 'expected_close_date', field_name: 'Expected Close Date', field_type: 'date', is_required: false, show_in_table: true, position: 0 },
      ],
    },
  ],
  order: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'date', field_name: 'Date', field_type: 'date', is_required: true, show_in_table: true, position: 0 },
      ],
    },
  ],
  dispatch: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'dispatch_date', field_name: 'Date', field_type: 'date', is_required: true, show_in_table: true, position: 0 },
      ],
    },
  ],
  quotation: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'date', field_name: 'Date', field_type: 'date', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'valid_until', field_name: 'Valid Until', field_type: 'date', is_required: false, show_in_table: true, position: 1 },
      ],
    },
  ],
  task: [
    {
      name: 'Schedule & Priority',
      position: 0,
      fields: [
        { system_key: 'due_date', field_name: 'Scheduled Date', field_type: 'date', is_required: false, show_in_table: true, position: 0 },
        { system_key: 'priority', field_name: 'Priority', field_type: 'text', is_required: true, show_in_table: true, position: 1 },
      ],
    },
  ],
  user: [
    {
      name: 'Profile',
      position: 0,
      fields: [
        { system_key: 'full_name', field_name: 'Name', field_type: 'text', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'employee_code', field_name: 'Employee Code', field_type: 'text', is_required: false, show_in_table: true, position: 1 },
        { system_key: 'employee_role_id', field_name: 'Employee Role', field_type: 'select', is_required: true, show_in_table: true, position: 2 },
        { system_key: 'status', field_name: 'Status', field_type: 'radio', is_required: true, show_in_table: true, position: 3 },
      ]
    },
    {
      name: 'Login Details',
      position: 10,
      fields: [
        { system_key: 'email', field_name: 'Email', field_type: 'email', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'password', field_name: 'Password', field_type: 'text', is_required: true, show_in_table: false, position: 1 },
        { system_key: 'repassword', field_name: 'Re-password', field_type: 'text', is_required: true, show_in_table: false, position: 2 },
      ]
    },
    {
      name: 'Contact Details',
      position: 20,
      fields: [
        { system_key: 'address', field_name: 'Address', field_type: 'textarea', is_required: false, show_in_table: false, position: 0 },
        { system_key: 'pincode', field_name: 'Pincode', field_type: 'text', is_required: false, show_in_table: false, position: 1 },
        { system_key: 'country', field_name: 'Country', field_type: 'text', is_required: false, show_in_table: false, position: 2 },
        { system_key: 'state', field_name: 'State', field_type: 'text', is_required: false, show_in_table: false, position: 3 },
        { system_key: 'city', field_name: 'City', field_type: 'text', is_required: false, show_in_table: false, position: 4 },
        { system_key: 'area', field_name: 'Area', field_type: 'text', is_required: false, show_in_table: false, position: 5 },
        { system_key: 'mobile', field_name: 'Contact Number', field_type: 'phone', is_required: false, show_in_table: true, position: 6 },
      ]
    }
  ],
  expense: [
    {
      name: 'Primary Details',
      position: 0,
      fields: [
        { system_key: 'expense_date', field_name: 'Date', field_type: 'date', is_required: true, show_in_table: true, position: 0 },
        { system_key: 'amount', field_name: 'Amount (₹)', field_type: 'number', is_required: true, show_in_table: true, position: 1 },
      ],
    },
  ],
};

/**
 * Idempotently seeds predefined default sections and system fields into custom_field_sections
 * and custom_fields for an account and module. Never overwrites existing admin customizations.
 */
export async function ensureDefaultSectionsAndFields(
  accountId: string,
  moduleName: string,
  userId?: string,
  supabase?: any
): Promise<void> {
  if (!accountId || !moduleName) return;

  const defaultDefinitions = DEFAULT_MODULE_SECTIONS_AND_FIELDS[moduleName];
  if (!defaultDefinitions) return;

  try {
    // 1. Check existing system fields for this module
    const { data: existingSystemFields, error: checkErr } = await supabase
      .from('custom_fields')
      .select('system_key')
      .eq('account_id', accountId)
      .eq('module_name', moduleName)
      .not('system_key', 'is', null);

    if (checkErr) {
      console.error('Error checking existing system fields:', checkErr);
      return;
    }

    const existingKeys = new Set(existingSystemFields?.map((f: any) => f.system_key) || []);

    // 2. Fetch existing sections to reuse if present
    const { data: existingSections } = await supabase
      .from('custom_field_sections')
      .select('*')
      .eq('account_id', accountId)
      .eq('module_name', moduleName);

    const sectionMap = new Map<string, string>();
    if (existingSections) {
      for (const sec of existingSections) {
        sectionMap.set(sec.name, sec.id);
      }
    }

    // 3. Create missing default sections and seed fields
    for (const defSection of defaultDefinitions) {
      let sectionId = sectionMap.get(defSection.name);

      if (!sectionId) {
        const { data: newSec, error: secErr } = await supabase
          .from('custom_field_sections')
          .insert({
            account_id: accountId,
            module_name: moduleName,
            name: defSection.name,
            position: defSection.position,
            is_active: true,
          })
          .select()
          .single();

        if (secErr || !newSec) {
          console.error('Failed to create default section:', secErr);
          continue;
        }
        sectionId = (newSec as CustomFieldSection).id;
        sectionMap.set(defSection.name, sectionId);
      }

      // Insert fields for this section that don't already exist
      for (const defField of defSection.fields) {
        if (existingKeys.has(defField.system_key)) continue;

        const { error: insertErr } = await supabase
          .from('custom_fields')
          .insert({
            account_id: accountId,
            user_id: userId || null,
            module_name: moduleName,
            section_id: sectionId,
            system_key: defField.system_key,
            field_name: defField.field_name,
            field_type: defField.field_type,
            is_required: defField.is_required,
            show_in_table: defField.show_in_table,
            is_sortable: defField.is_sortable ?? true,
            is_filterable: defField.is_filterable ?? true,
            position: defField.position,
            is_active: true,
          });

        if (!insertErr) {
          existingKeys.add(defField.system_key);
        }
      }
    }

    // NOTE: A per-load "cleanup" block used to live here that DELETEd fields by
    // field_name (e.g. 'Status', 'Stock', 'Pincode') on every builder/form open.
    // Because it matched on name, it silently wiped admin-created custom fields
    // that shared a legacy name, and it deleted product `min_price` that the
    // form still needs. It was one-time migration logic that never should have
    // run on every load. Removed 2026-08-21. Seeding above is insert-if-missing
    // and never mutates or deletes existing fields. Any genuine one-off data
    // normalization must be a versioned SQL migration, not a per-load mutation.
  } catch (err) {
    console.error('Failed in ensureDefaultSectionsAndFields:', err);
  }
}

/**
 * Validates that all active fields marked as required (is_required = true)
 * have a non-empty value, checking formData for system_key fields and customValues for custom fields.
 */
export function validateRequiredCustomFields(
  customFields: CustomField[],
  customValues: Record<string, any>,
  formData?: Record<string, any>
): string | null {
  for (const field of customFields) {
    if (field.is_active !== false && field.is_required) {
      let val: any;
      if (field.system_key && formData) {
        val = formData[field.system_key];
      } else {
        val = customValues[field.id];
      }

      if (
        val === undefined ||
        val === null ||
        String(val).trim() === '' ||
        (Array.isArray(val) && val.length === 0)
      ) {
        return `Please fill in the required field: "${field.field_name}"`;
      }
    }
  }
  return null;
}

/**
 * Transforms base data table columns based on admin-defined visibility and labels in customFields,
 * and appends custom field columns.
 */
export function getVisibleTableColumns<T extends Record<string, any>>(
  baseColumns: ColumnDef<T>[],
  customFields: CustomField[],
  dataRows: T[]
): ColumnDef<T>[] {
  const systemFieldMap = new Map<string, CustomField>();
  for (const cf of customFields) {
    if (cf.system_key) {
      systemFieldMap.set(cf.system_key, cf);
    }
  }

  // 1. Filter base columns and update labels/sortability per admin configuration
  const visibleColumns = baseColumns.filter((col) => {
    // Actions column is always shown
    if (col.id === 'actions') return true;
    const sysField = systemFieldMap.get(col.id);
    if (sysField && (sysField.show_in_table === false || sysField.is_active === false)) {
      return false;
    }
    if (sysField) {
      col.label = sysField.field_name || col.label;
      if (sysField.is_sortable === false) {
        col.sortable = false;
      }
    }
    return true;
  });

  // 2. Append custom fields without a system_key
  const nonSystemFields = customFields.filter((cf) => !cf.system_key);
  appendCustomFieldColumns(visibleColumns, nonSystemFields, dataRows);

  // 3. Guard against duplicate column ids (a conditional column added twice, or a
  //    custom field colliding with a system column) — React uses `col.id` as the
  //    table key, and a duplicate throws "two children with the same key". Keep
  //    the first occurrence.
  const seen = new Set<string>();
  return visibleColumns.filter((col) => {
    if (seen.has(col.id)) return false;
    seen.add(col.id);
    return true;
  });
}

/**
 * Appends custom field columns to a DataTable columns array based on admin configuration.
 */
export function appendCustomFieldColumns<T extends Record<string, any>>(
  columns: ColumnDef<T>[],
  customFields: CustomField[],
  dataRows: T[]
): void {
  customFields.forEach((cf) => {
    if (cf.show_in_table === false || cf.is_active === false) return;

    let type: ColumnFilterType | undefined = 'text';
    let options: { label: string; value: string }[] | undefined = undefined;

    if (
      cf.field_type === 'dropdown' ||
      cf.field_type === 'radio' ||
      cf.field_type === 'multi-select'
    ) {
      type = 'select';
      const uniqueVals = Array.from(
        new Set(dataRows.map((r) => r[`cf_${cf.id}`]).filter(Boolean))
      ) as string[];
      options = uniqueVals.map((val) => ({ label: val, value: val }));
    } else if (cf.field_type === 'date') {
      type = 'date';
    }

    if (cf.is_filterable === false) {
      type = undefined;
      options = undefined;
    }

    const sortable = cf.is_sortable !== false;

    const insertIndex =
      columns.length > 0 && columns[columns.length - 1].id === 'actions'
        ? columns.length - 1
        : columns.length;

    columns.splice(insertIndex, 0, {
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options && options.length > 0 ? options : undefined,
      visibleByDefault: true,
      sortable: sortable,
      render: (row) => {
        const val = row[`cf_${cf.id}`];
        if (val === undefined || val === null || val === '') {
          return React.createElement('span', { className: 'text-muted-foreground' }, '-');
        }

        if (cf.field_type === 'checkbox') {
          return React.createElement('span', null, val === 'true' || val === true ? 'Yes' : 'No');
        }
        if (cf.field_type === 'attachment') {
          return React.createElement(
            'a',
            {
              href: String(val),
              target: '_blank',
              rel: 'noreferrer',
              className: 'text-primary hover:underline',
              onClick: (e: React.MouseEvent) => e.stopPropagation(),
            },
            'View'
          );
        }
        return React.createElement('span', null, String(val));
      },
    });
  });
}

/**
 * Checks if any searchable custom field matches the query string.
 */
export function matchesSearchableCustomFields(
  row: Record<string, any>,
  customFields: CustomField[],
  searchQuery: string
): boolean {
  if (!searchQuery) return false;
  const q = searchQuery.toLowerCase();
  return customFields.some((cf) => {
    if (cf.is_searchable === false || cf.is_active === false) return false;
    const val = row[`cf_${cf.id}`];
    return val && String(val).toLowerCase().includes(q);
  });
}

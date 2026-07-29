import React from 'react';
import type { ColumnDef, ColumnFilterType } from '@/components/ui/data-table/data-table-types';
import type { CustomField } from '@/types';

/**
 * Validates that all active custom fields marked as required (is_required = true)
 * have a non-empty value in customValues.
 * Returns an error message string if any required field is empty, or null if valid.
 */
export function validateRequiredCustomFields(
  customFields: CustomField[],
  customValues: Record<string, any>
): string | null {
  for (const field of customFields) {
    if (field.is_active !== false && field.is_required) {
      const val = customValues[field.id];
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
 * Appends custom field columns to a DataTable columns array based on admin configuration
 * (show_in_table, is_sortable, is_filterable).
 */
export function appendCustomFieldColumns<T extends Record<string, any>>(
  columns: ColumnDef<T>[],
  customFields: CustomField[],
  dataRows: T[]
): void {
  customFields.forEach((cf) => {
    // 1. Admin option: Show in Data Table (defaults to true if undefined)
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

    // 2. Admin option: Filterable (defaults to true if undefined)
    if (cf.is_filterable === false) {
      type = undefined;
      options = undefined;
    }

    // 3. Admin option: Sortable (defaults to true if undefined)
    const sortable = cf.is_sortable !== false;

    // We splice before the trailing "actions" column if present, else push
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

import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Standard EWO-004A Metadata Columns attached to every table.
 */
const metadataColumns = [
  { name: 'created_at', type: 'number' },
  { name: 'updated_at', type: 'number' },
  { name: 'deleted_at', type: 'number', isOptional: true },
  { name: 'sync_version', type: 'number' },
  { name: 'sync_status', type: 'string' },
  { name: 'tenant_id', type: 'string', isIndexed: true },
  { name: 'user_id', type: 'string' },
  { name: 'device_id', type: 'string' },
  { name: 'runtime_version', type: 'string' },
  { name: 'storage_version', type: 'string' },
  { name: 'schema_version', type: 'string' },
  { name: 'trace_id', type: 'string', isOptional: true },
  { name: 'correlation_id', type: 'string', isOptional: true },
  { name: 'operation_id', type: 'string', isOptional: true }
] as const;

export const mySchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: '_sys_metadata',
      columns: [
        { name: 'key', type: 'string', isIndexed: true },
        { name: 'value', type: 'string' },
        ...metadataColumns
      ]
    }),
    tableSchema({
      name: 'contacts',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'phone', type: 'string' },
        { name: 'email', type: 'string', isOptional: true },
        ...metadataColumns
      ]
    }),
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'contact_id', type: 'string', isOptional: true },
        ...metadataColumns
      ]
    }),
    tableSchema({
      name: 'expenses',
      columns: [
        { name: 'amount', type: 'number' },
        { name: 'description', type: 'string' },
        ...metadataColumns
      ]
    })
  ]
});

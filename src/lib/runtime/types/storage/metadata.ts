export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'dead';

/**
 * Standardized Metadata that every record in every storage provider MUST support.
 * This guarantees multi-tenant safety and sync engine traceability.
 */
export interface RecordMetadata {
  /** Timestamp of initial creation */
  created_at: Date;
  /** Timestamp of last modification */
  updated_at: Date;
  /** Soft delete marker timestamp */
  deleted_at?: Date;
  
  /** Optimistic concurrency control / logical clock */
  sync_version: number;
  /** Current state in the Sync Engine lifecycle */
  sync_status: SyncStatus;
  
  /** Security boundaries */
  tenant_id: string;
  user_id: string;
  device_id: string;
  
  /** System tracking */
  runtime_version: string;
  storage_version: string;
  schema_version: string;
  
  /** Observability & Tracing */
  trace_id?: string;
  correlation_id?: string;
  operation_id?: string; // Matches the SyncQueue operation ID
}

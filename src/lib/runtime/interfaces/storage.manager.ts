import { StorageCapabilities } from '../types/storage/capabilities';
import { StorageQuery, StorageQueryResult, StorageAggregation } from '../types/storage/query';
import { RecordMetadata } from '../types/storage/metadata';

export type TransactionCallback = (manager: IStorageManager) => Promise<void>;

/**
 * Enterprise Storage Abstraction Layer
 * 
 * This interface defines the contract that EVERY concrete storage provider 
 * (WatermelonDB, SQLite, IndexedDB) must implement. The Runtime Platform relies ONLY
 * on this interface, ensuring 100% storage provider agnosticism.
 */
export interface IStorageManager {
  // ==========================================
  // Lifecycle & Registration
  // ==========================================
  
  /** Boots up the DB, runs migrations, validates schemas, checks health. */
  initialize(): Promise<void>;
  
  /** Gracefully closes connections, flushes WAL, halts background syncing. */
  shutdown(): Promise<void>;
  
  /** Retrieves the capabilities of this specific provider to allow Runtime adaptation. */
  capabilities(): StorageCapabilities;
  
  /** Retrieves the engine version, schema version, and driver info. */
  version(): Promise<{ engine: string, schema: string, driver: string }>;

  // ==========================================
  // Transactions & Batching
  // ==========================================
  
  /** Executes a callback within an ACID transaction. Rolls back on throw. */
  transaction(action: TransactionCallback): Promise<void>;
  
  /** 
   * Executes an array of raw operations optimally.
   * Differs from transaction by omitting isolation locks for pure speed if supported. 
   */
  batch(operations: Array<{ action: 'insert'|'update'|'delete', collection: string, id: string, data?: any }>): Promise<void>;

  // ==========================================
  // Core CRUD
  // ==========================================
  
  /** Inserts a new record. Throws if ID exists. */
  insert<T>(collection: string, id: string, data: Omit<T, keyof RecordMetadata>): Promise<T & RecordMetadata>;
  
  /** Updates an existing record. Throws if ID does not exist. */
  update<T>(collection: string, id: string, data: Partial<T>): Promise<T & RecordMetadata>;
  
  /** Inserts if missing, updates if exists. */
  upsert<T>(collection: string, id: string, data: Partial<T>): Promise<T & RecordMetadata>;
  
  /** Soft or hard deletes a record based on implementation rules. */
  delete(collection: string, id: string, softDelete?: boolean): Promise<void>;

  // ==========================================
  // Querying & Retrieval
  // ==========================================
  
  /** Fetches a single record by primary key. Returns null if missing. */
  find<T>(collection: string, id: string): Promise<(T & RecordMetadata) | null>;
  
  /** Fetches the first record matching the query. */
  findOne<T>(collection: string, query: StorageQuery): Promise<(T & RecordMetadata) | null>;
  
  /** Executes an agnostic query (filters, sort, pagination, projection). */
  query<T>(collection: string, query: StorageQuery): Promise<StorageQueryResult<T & RecordMetadata>>;
  
  /** Fast path to check if a record exists. O(1) index lookup. */
  exists(collection: string, id: string): Promise<boolean>;
  
  /** Returns the exact count of records matching the query. */
  count(collection: string, query?: StorageQuery): Promise<number>;
  
  /** Performs aggregation (sum, avg, min, max) natively in the DB. */
  aggregate(collection: string, agg: StorageAggregation, query?: StorageQuery): Promise<number>;

  // ==========================================
  // Maintenance & Observability
  // ==========================================
  
  /** Drops all data in a collection (Truncate). */
  clear(collection: string): Promise<void>;
  
  /** Cleans up fragmented space (e.g. SQLite VACUUM). */
  vacuum(): Promise<void>;
  
  /** Compresses data files if supported. */
  compact(): Promise<void>;
  
  /** Generates a physical backup file. Returns the path or blob. */
  backup(destination?: string): Promise<string>;
  
  /** Restores the database from a backup file. */
  restore(source: string): Promise<void>;
  
  /** Verifies database integrity (e.g. PRAGMA integrity_check). */
  health(): Promise<{ status: 'healthy' | 'degraded' | 'corrupted', details: string }>;
  
  /** Returns telemetry on DB size, cache hits, index usage, and read/write latency. */
  metrics(): Promise<Record<string, any>>;
}

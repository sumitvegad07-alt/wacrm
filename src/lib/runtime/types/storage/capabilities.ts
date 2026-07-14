export interface StorageCapabilities {
  /** Supports ACID transactions */
  transactions: boolean;
  
  /** Supports bulk insert/update */
  batchWrites: boolean;
  
  /** Supports secondary indexing */
  indexes: boolean;
  
  /** Supports Full Text Search natively */
  fullTextSearch: boolean;
  
  /** Supports native data encryption at rest */
  encryption: boolean;
  
  /** Supports native compression */
  compression: boolean;
  
  /** Supports storing large binaries natively */
  blobStorage: boolean;
  
  /** Supports streaming query results */
  streaming: boolean;
  
  /** Can sync in the background automatically (e.g. Realm, PowerSync) */
  backgroundSync: boolean;
  
  /** Can perform partial record updates (Delta Sync) */
  deltaSync: boolean;
  
  /** Can handle > 100k records without memory faults */
  largeDataset: boolean;
}

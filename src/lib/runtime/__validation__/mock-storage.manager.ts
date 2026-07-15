import { IStorageManager, TransactionCallback } from '../interfaces/storage.manager';
import { StorageCapabilities } from '../types/storage/capabilities';
import { StorageQuery, StorageQueryResult, StorageAggregation } from '../types/storage/query';
import { RecordMetadata } from '../types/storage/metadata';
import { FaultInjector } from './fault-injector';

export class MockStorageManager implements IStorageManager {
  private data: Map<string, Map<string, any>> = new Map();
  private latencyMs: number = 0;

  public setSimulatedLatency(ms: number) {
    this.latencyMs = ms;
  }

  private async delay() {
    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }
  }

  private getCollection(collection: string) {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    return this.data.get(collection)!;
  }

  // Lifecycle
  async initialize(): Promise<void> { await this.delay(); }
  async shutdown(): Promise<void> { await this.delay(); }
  capabilities(): StorageCapabilities {
    return {
      transactions: true, batchWrites: true, indexes: false, fullTextSearch: false,
      encryption: false, compression: false, blobStorage: false, streaming: false,
      backgroundSync: false, deltaSync: false, largeDataset: false
    };
  }
  async version() { return { engine: 'Mock', schema: '1.0', driver: 'mock' }; }

  // Transactions & Batching
  async transaction(action: TransactionCallback): Promise<void> {
    const snapshot = this.createSnapshot();
    try {
      await action(this);
    } catch (e) {
      this.restoreSnapshot(snapshot);
      throw e;
    }
  }

  async batch(operations: Array<{ action: 'insert'|'update'|'delete', collection: string, id: string, data?: any }>): Promise<void> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    for (const op of operations) {
      if (op.action === 'delete') {
        await this.delete(op.collection, op.id);
      } else if (op.action === 'insert') {
        await this.insert(op.collection, op.id, op.data);
      } else {
        await this.update(op.collection, op.id, op.data);
      }
    }
  }

  // Core CRUD
  async insert<T>(collection: string, id: string, data: Omit<T, keyof RecordMetadata>): Promise<T & RecordMetadata> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    if (coll.has(id)) throw new Error('Already exists');
    const record = JSON.parse(JSON.stringify(data));
    record.id = id;
    coll.set(id, record);
    return record;
  }

  async update<T>(collection: string, id: string, data: Partial<T>): Promise<T & RecordMetadata> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    if (!coll.has(id)) throw new Error('Not found');
    const existing = coll.get(id);
    const updated = { ...existing, ...JSON.parse(JSON.stringify(data)) };
    coll.set(id, updated);
    return updated;
  }

  async upsert<T>(collection: string, id: string, data: Partial<T>): Promise<T & RecordMetadata> {
    if (await this.exists(collection, id)) return this.update(collection, id, data);
    return this.insert(collection, id, data as any);
  }

  async delete(collection: string, id: string, softDelete?: boolean): Promise<void> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    if (softDelete) {
      const existing = coll.get(id);
      if (existing) coll.set(id, { ...existing, _deleted: true });
    } else {
      coll.delete(id);
    }
  }

  // Querying
  async find<T>(collection: string, id: string): Promise<(T & RecordMetadata) | null> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    return (coll.get(id) as T & RecordMetadata) || null;
  }

  async findOne<T>(collection: string, query: StorageQuery): Promise<(T & RecordMetadata) | null> {
    const res = await this.query<T>(collection, query);
    return res.data[0] || null;
  }

  async query<T>(collection: string, queryDef: StorageQuery): Promise<StorageQueryResult<T & RecordMetadata>> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    return { data: Array.from(coll.values()) as (T & RecordMetadata)[] };
  }

  async exists(collection: string, id: string): Promise<boolean> {
    return (await this.find(collection, id)) !== null;
  }

  async count(collection: string, query?: StorageQuery): Promise<number> {
    const res = await this.query(collection, query || { collection });
    return res.data.length;
  }

  async aggregate(collection: string, agg: StorageAggregation, query?: StorageQuery): Promise<number> {
    return 0;
  }

  // Maintenance
  async clear(collection: string): Promise<void> {
    await this.delay();
    this.data.delete(collection);
  }
  
  async vacuum(): Promise<void> {}
  async compact(): Promise<void> {}
  async backup(): Promise<string> { return 'mock.bak'; }
  async restore(): Promise<void> {}
  async health(): Promise<any> { return { status: 'healthy', details: 'mock ok' }; }

  async metrics(): Promise<Record<string, any>> {
    let size = 0;
    for (const [colName, col] of this.data.entries()) {
      size += colName.length;
      for (const [id, val] of col.entries()) {
        size += id.length;
        size += JSON.stringify(val).length;
      }
    }
    return { dbSizeBytes: size, transactionCount: 0 };
  }

  // Internal
  private createSnapshot() {
    const snapshot = new Map<string, Map<string, any>>();
    for (const [colName, col] of this.data.entries()) {
      const clonedCol = new Map();
      for (const [id, val] of col.entries()) {
        clonedCol.set(id, JSON.parse(JSON.stringify(val)));
      }
      snapshot.set(colName, clonedCol);
    }
    return snapshot;
  }

  private restoreSnapshot(snapshot: Map<string, Map<string, any>>) {
    this.data = snapshot;
  }
}

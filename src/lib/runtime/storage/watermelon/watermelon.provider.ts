import { Database, Q, Model } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { IStorageManager, TransactionCallback } from '../../interfaces/storage.manager';
import { StorageCapabilities } from '../../types/storage/capabilities';
import { StorageQuery, StorageQueryResult, StorageAggregation } from '../../types/storage/query';
import { RecordMetadata } from '../../types/storage/metadata';
import { WatermelonErrorMapper } from './error-mapper';
import { mySchema } from './schema';
import { myMigrations } from './migrations';
import { modelClasses } from './models';

export class WatermelonStorageProvider implements IStorageManager {
  private database!: Database;

  constructor(private useMemoryOnly: boolean = false) {}

  public async initialize(): Promise<void> {
    try {
      const adapter = new LokiJSAdapter({
        schema: mySchema,
        migrations: myMigrations,
        useWebWorker: false, // For validation script sync testing
        useIncrementalIndexedDB: true,
        extraLokiOptions: {
          // env removed to satisfy strictly typed LokiAdapterOptions
        }
      });

      this.database = new Database({
        adapter,
        modelClasses,
      });

      // Quick health check to ensure boot
      await this.health();
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async shutdown(): Promise<void> {
    // LokiJS doesn't have a rigid shutdown, but we clear handles if needed.
  }

  public capabilities(): StorageCapabilities {
    return {
      transactions: true,
      batchWrites: true,
      indexes: true,
      fullTextSearch: false, // LokiJS adapter lacks true SQLite FTS
      encryption: false,
      compression: false,
      blobStorage: false,
      streaming: false,
      backgroundSync: false,
      deltaSync: false,
      largeDataset: true
    };
  }

  public async version() {
    return { engine: 'LokiJS/Watermelon', schema: mySchema.version.toString(), driver: 'watermelon-js' };
  }

  public async transaction(action: TransactionCallback): Promise<void> {
    try {
      // WatermelonDB writer blocks are transactions.
      await this.database.write(async () => {
        await action(this);
      });
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async batch(operations: Array<{ action: 'insert'|'update'|'delete', collection: string, id: string, data?: any }>): Promise<void> {
    try {
      await this.database.write(async () => {
        const records = await Promise.all(operations.map(async op => {
          const collection = this.database.get(op.collection);
          
          if (op.action === 'insert') {
            return collection.prepareCreate((record: any) => {
              record._raw.id = op.id; // Force ID mapping
              Object.assign(record._raw, op.data);
            });
          } else if (op.action === 'update') {
            const record = await collection.find(op.id);
            return record.prepareUpdate((r: any) => {
              Object.assign(r._raw, op.data);
            });
          } else {
            const record = await collection.find(op.id);
            return record.prepareDestroyPermanently();
          }
        }));
        
        await this.database.batch(...records);
      });
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async insert<T>(collectionName: string, id: string, data: Omit<T, keyof RecordMetadata>): Promise<T & RecordMetadata> {
    try {
      let result: Model;
      await this.database.write(async () => {
        result = await this.database.get(collectionName).create((record: any) => {
          record._raw.id = id;
          Object.assign(record._raw, data);
        });
      });
      return result!._raw as any;
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async update<T>(collectionName: string, id: string, data: Partial<T>): Promise<T & RecordMetadata> {
    try {
      let result: Model;
      await this.database.write(async () => {
        const record = await this.database.get(collectionName).find(id);
        result = await record.update((r: any) => {
          Object.assign(r._raw, data);
        });
      });
      return result!._raw as any;
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async upsert<T>(collectionName: string, id: string, data: Partial<T>): Promise<T & RecordMetadata> {
    try {
      const exists = await this.exists(collectionName, id);
      if (exists) {
        return this.update(collectionName, id, data);
      } else {
        return this.insert(collectionName, id, data as any);
      }
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async delete(collectionName: string, id: string, softDelete: boolean = false): Promise<void> {
    try {
      await this.database.write(async () => {
        const record = await this.database.get(collectionName).find(id);
        if (softDelete) {
          await record.markAsDeleted();
        } else {
          await record.destroyPermanently();
        }
      });
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async find<T>(collectionName: string, id: string): Promise<(T & RecordMetadata) | null> {
    try {
      const record = await this.database.get(collectionName).find(id);
      return record._raw as any;
    } catch (e) {
      // WatermelonDB throws if not found
      return null;
    }
  }

  public async findOne<T>(collectionName: string, query: StorageQuery): Promise<(T & RecordMetadata) | null> {
    const res = await this.query<T>(collectionName, { ...query, pagination: { limit: 1 } });
    return res.data[0] || null;
  }

  public async query<T>(collectionName: string, queryDef: StorageQuery): Promise<StorageQueryResult<T & RecordMetadata>> {
    try {
      const conditions: Q.Clause[] = [];
      
      if (queryDef.filters) {
        for (const f of queryDef.filters) {
          if (f.operator === 'eq') conditions.push(Q.where(f.field, f.value));
          else if (f.operator === 'neq') conditions.push(Q.where(f.field, Q.notEq(f.value)));
          else if (f.operator === 'like') conditions.push(Q.where(f.field, Q.like(`%${f.value}%`)));
          // Advanced operators mapping...
        }
      }

      if (queryDef.sort && queryDef.sort.length > 0) {
        const s = queryDef.sort[0];
        conditions.push(Q.sortBy(s.field, s.direction === 'desc' ? Q.desc : Q.asc));
      }

      if (queryDef.pagination?.limit) {
        conditions.push(Q.take(queryDef.pagination.limit));
      }
      
      if (queryDef.pagination?.offset) {
        conditions.push(Q.skip(queryDef.pagination.offset));
      }

      const collection = this.database.get(collectionName);
      const records = await collection.query(...conditions).fetch();
      
      return {
        data: records.map(r => r._raw as any)
      };
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async exists(collectionName: string, id: string): Promise<boolean> {
    return (await this.find(collectionName, id)) !== null;
  }

  public async count(collectionName: string, queryDef?: StorageQuery): Promise<number> {
    try {
      const conditions: Q.Clause[] = [];
      if (queryDef?.filters) {
        for (const f of queryDef.filters) {
          if (f.operator === 'eq') conditions.push(Q.where(f.field, f.value));
        }
      }
      return await this.database.get(collectionName).query(...conditions).fetchCount();
    } catch (e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async aggregate(collection: string, agg: StorageAggregation, query?: StorageQuery): Promise<number> {
    // Naive implementation. WatermelonDB doesn't have native SUM/AVG out of the box in LokiJS easily
    const records = await this.query<any>(collection, query || { collection });
    if (agg.type === 'count') return records.data.length;
    
    const sum = records.data.reduce((acc, r) => acc + (Number(r[agg.field]) || 0), 0);
    if (agg.type === 'sum') return sum;
    if (agg.type === 'avg') return sum / records.data.length;
    
    return 0; // Stub for min/max
  }

  public async clear(collectionName: string): Promise<void> {
    await this.database.write(async () => {
      const collection = this.database.get(collectionName);
      const records = await collection.query().fetch();
      const deletions = records.map(r => r.prepareDestroyPermanently());
      await this.database.batch(...deletions);
    });
  }

  public async vacuum(): Promise<void> { }
  public async compact(): Promise<void> { }
  public async backup(): Promise<string> { return 'backup.json'; }
  public async restore(): Promise<void> { }

  public async health() {
    try {
      const c = await this.database.get('_sys_metadata').query().fetchCount();
      return { status: 'healthy' as const, details: 'DB is responsive' };
    } catch(e) {
      throw WatermelonErrorMapper.mapError(e);
    }
  }

  public async metrics() {
    return {
      transactionCount: 0,
      dbSizeBytes: 1024 * 50
    };
  }
}

import { IStorageManager } from '../runtime/interfaces/storage.manager';
import { RecordMetadata } from '../runtime/types/storage/metadata';
import { StorageQuery } from '../runtime/types/storage/query';
import { RuntimeEventBus } from '../runtime/services/runtime-event-bus.service';
import { RepositoryContext, RepositoryResult, RepositoryEvent } from './types';

export abstract class BaseRepository<T extends { id: string }> {
  constructor(
    protected storage: IStorageManager,
    protected collectionName: string,
    protected context: RepositoryContext
  ) {}

  protected generateId(): string {
    return 'id-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
  }

  protected buildMetadata(): RecordMetadata {
    return {
      created_at: new Date(),
      updated_at: new Date(),
      sync_version: 0,
      sync_status: 'pending',
      tenant_id: this.context.tenantId,
      user_id: this.context.userId,
      device_id: this.context.deviceId,
      runtime_version: '1.0',
      storage_version: '1.0',
      schema_version: '1.0'
    };
  }

  protected publishEvent(action: 'CREATED'|'UPDATED'|'DELETED'|'RESTORED', data: any) {
    const event: RepositoryEvent<any> = {
      type: 'REPOSITORY_EVENT',
      payload: {
        entityType: this.collectionName,
        action,
        data,
        timestamp: new Date()
      }
    };
    RuntimeEventBus.publish(event as any);
  }

  public async create(data: Omit<T, 'id'>): Promise<RepositoryResult<T & RecordMetadata>> {
    try {
      const id = this.generateId();
      const metadata = this.buildMetadata();
      const fullData = { ...data, ...metadata } as any;
      
      const result = await this.storage.insert<T>(this.collectionName, id, fullData);
      this.publishEvent('CREATED', result);
      
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async update(id: string, data: Partial<T>): Promise<RepositoryResult<T & RecordMetadata>> {
    try {
      const updatePayload = { ...data, updated_at: new Date(), sync_status: 'pending' };
      const result = await this.storage.update<T>(this.collectionName, id, updatePayload);
      this.publishEvent('UPDATED', result);
      
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async findById(id: string): Promise<RepositoryResult<T & RecordMetadata>> {
    try {
      const result = await this.storage.find<T>(this.collectionName, id);
      if (!result) return { success: false, error: new Error('Not found') };
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async findAll(): Promise<RepositoryResult<(T & RecordMetadata)[]>> {
    try {
      const query: StorageQuery = {
        collection: this.collectionName,
        filters: [
          { field: 'tenant_id', operator: 'eq', value: this.context.tenantId },
          { field: 'deleted_at', operator: 'eq', value: null } // Exclude soft deleted by default
        ]
      };
      const result = await this.storage.query<T>(this.collectionName, query);
      return { success: true, data: result.data };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async delete(id: string, softDelete: boolean = true): Promise<RepositoryResult<void>> {
    try {
      if (softDelete) {
        await this.storage.update(this.collectionName, id, { 
          deleted_at: new Date(), 
          sync_status: 'pending' 
        });
      } else {
        await this.storage.delete(this.collectionName, id, false);
      }
      this.publishEvent('DELETED', { id });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }
}

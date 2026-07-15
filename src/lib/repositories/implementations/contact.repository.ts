import { BaseRepository } from '../base.repository';
import { IContactRepository, Contact } from '../interfaces';
import { RepositoryResult, RepositoryBatchResult } from '../types';
import { RecordMetadata } from '../../runtime/types/storage/metadata';

export class ContactRepository extends BaseRepository<Contact> implements IContactRepository {
  
  public async findByPhone(phone: string): Promise<RepositoryResult<Contact & RecordMetadata>> {
    try {
      const res = await this.storage.findOne<Contact>(this.collectionName, {
        collection: this.collectionName,
        filters: [
          { field: 'phone', operator: 'eq', value: phone },
          { field: 'tenant_id', operator: 'eq', value: this.context.tenantId }
        ]
      });
      if (!res) return { success: false, error: new Error('Contact not found') };
      return { success: true, data: res };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async search(query: string): Promise<RepositoryResult<(Contact & RecordMetadata)[]>> {
    try {
      const res = await this.storage.query<Contact>(this.collectionName, {
        collection: this.collectionName,
        filters: [
          { field: 'name', operator: 'like', value: query },
          { field: 'tenant_id', operator: 'eq', value: this.context.tenantId }
        ]
      });
      return { success: true, data: res.data };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }

  public async bulkInsert(contacts: Omit<Contact, 'id'>[]): Promise<RepositoryBatchResult> {
    try {
      const operations = contacts.map(c => {
        const id = this.generateId();
        const metadata = this.buildMetadata();
        return {
          action: 'insert' as const,
          collection: this.collectionName,
          id,
          data: { id, ...c, ...metadata }
        };
      });

      await this.storage.batch(operations);
      
      const insertedData = operations.map(op => op.data);
      this.publishEvent('CREATED', insertedData);
      
      return { success: true, insertedCount: contacts.length, updatedCount: 0, deletedCount: 0 };
    } catch (e: any) {
      return { success: false, insertedCount: 0, updatedCount: 0, deletedCount: 0, error: e };
    }
  }
}

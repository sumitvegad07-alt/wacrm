import { BaseRepository } from '../base.repository';
import { ITaskRepository, Task } from '../interfaces';
import { RepositoryResult } from '../types';
import { RecordMetadata } from '../../runtime/types/storage/metadata';

export class TaskRepository extends BaseRepository<Task> implements ITaskRepository {
  
  public async findByStatus(status: string): Promise<RepositoryResult<(Task & RecordMetadata)[]>> {
    try {
      const res = await this.storage.query<Task>(this.collectionName, {
        collection: this.collectionName,
        filters: [
          { field: 'status', operator: 'eq', value: status },
          { field: 'tenant_id', operator: 'eq', value: this.context.tenantId },
          { field: 'deleted_at', operator: 'eq', value: null }
        ]
      });
      return { success: true, data: res.data };
    } catch (e: any) {
      return { success: false, error: e };
    }
  }
}

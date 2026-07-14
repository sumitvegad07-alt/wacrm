import { RepositoryResult, RepositoryBatchResult } from '../types';
import { RecordMetadata } from '../../runtime/types/storage/metadata';

export interface Contact { id: string; name: string; phone: string; email?: string; }
export interface Task { id: string; title: string; status: string; contactId?: string; }
export interface Expense { id: string; amount: number; description: string; }
export interface Attachment { id: string; entityId: string; entityType: string; localPath: string; uploadStatus: 'pending' | 'uploaded' | 'failed'; }
export interface GPSPoint { id: string; lat: number; lng: number; timestamp: number; }

export interface IBaseRepository<T> {
  create(data: Omit<T, 'id'>): Promise<RepositoryResult<T & RecordMetadata>>;
  update(id: string, data: Partial<T>): Promise<RepositoryResult<T & RecordMetadata>>;
  findById(id: string): Promise<RepositoryResult<T & RecordMetadata>>;
  findAll(): Promise<RepositoryResult<(T & RecordMetadata)[]>>;
  delete(id: string, softDelete?: boolean): Promise<RepositoryResult<void>>;
}

export interface IContactRepository extends IBaseRepository<Contact> {
  findByPhone(phone: string): Promise<RepositoryResult<Contact & RecordMetadata>>;
  search(query: string): Promise<RepositoryResult<(Contact & RecordMetadata)[]>>;
  bulkInsert(contacts: Omit<Contact, 'id'>[]): Promise<RepositoryBatchResult>;
}

export interface ITaskRepository extends IBaseRepository<Task> {
  findByStatus(status: string): Promise<RepositoryResult<(Task & RecordMetadata)[]>>;
}

export interface IExpenseRepository extends IBaseRepository<Expense> {}
export interface IAttachmentRepository extends IBaseRepository<Attachment> {}
export interface IGPSRepository extends IBaseRepository<GPSPoint> {
  bulkInsert(points: Omit<GPSPoint, 'id'>[]): Promise<RepositoryBatchResult>;
}

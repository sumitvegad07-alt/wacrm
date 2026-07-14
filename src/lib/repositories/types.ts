export interface RepositoryContext {
  tenantId: string;
  userId: string;
  deviceId: string;
}

export interface RepositoryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

export interface RepositoryBatchResult {
  success: boolean;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  error?: Error;
}

export type RepositoryEventAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'RESTORED' | 'BATCH_COMPLETED';

export interface RepositoryEvent<T> {
  type: 'REPOSITORY_EVENT';
  payload: {
    entityType: string;
    action: RepositoryEventAction;
    data: T | T[];
    timestamp: Date;
  };
}

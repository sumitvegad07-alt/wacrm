import { QueueOperation, QueueOperationStatus, QueuePriority } from '../types/queue';
import { RuntimeEventBus } from './runtime-event-bus.service';
import { IAuthProvider } from '../interfaces/auth.provider';

export class SyncQueueServiceImpl {
  private static instance: SyncQueueServiceImpl;
  
  // O(1) Bucket Queues based on Priority to replace array.sort()
  private buckets: Record<QueuePriority, QueueOperation[]> = {
    high: [],
    normal: [],
    low: [],
    background: []
  };
  
  // Quick lookup map for operations by ID (O(1) access)
  private operationsMap: Map<string, QueueOperation> = new Map();

  private authProvider: IAuthProvider | null = null;

  private constructor() {}

  public static getInstance(): SyncQueueServiceImpl {
    if (!SyncQueueServiceImpl.instance) {
      SyncQueueServiceImpl.instance = new SyncQueueServiceImpl();
    }
    return SyncQueueServiceImpl.instance;
  }

  public registerAuthProvider(provider: IAuthProvider) {
    this.authProvider = provider;
  }

  /**
   * Enqueues an operation into the correct O(1) Priority Bucket.
   */
  public enqueue(operation: Omit<QueueOperation, 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>): void {
    const newOp: QueueOperation = {
      ...operation,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0,
    };
    
    this.buckets[newOp.priority].push(newOp);
    this.operationsMap.set(newOp.id, newOp);
    this.broadcastStatus();
  }

  /**
   * Retrieves pending operations. Validates Tenant ID on the fly.
   */
  public getPendingOperations(): QueueOperation[] {
    const currentTenant = this.authProvider?.getTenantId();
    const currentUser = this.authProvider?.getUserId();
    
    const pending: QueueOperation[] = [];
    
    // Drain buckets in order
    const priorities: QueuePriority[] = ['high', 'normal', 'low', 'background'];
    
    for (const priority of priorities) {
      for (const op of this.buckets[priority]) {
        if (op.status === 'pending') {
          // Security Validation: Cross-Tenant Data Bleed Protection
          if (this.authProvider) {
            if (op.metadata.tenant_id !== currentTenant || op.metadata.user_id !== currentUser) {
              // We do not return it for processing. It either waits or gets purged depending on policy.
              console.warn(`[SyncQueue] Halting operation ${op.id} due to Tenant/User mismatch.`);
              continue;
            }
          }
          pending.push(op);
        }
      }
    }
    
    return pending;
  }

  public updateOperationStatus(id: string, status: QueueOperationStatus, error?: string): void {
    const op = this.operationsMap.get(id);
    if (op) {
      op.status = status;
      op.updatedAt = new Date();
      if (error) op.error = error;
      
      if (status === 'completed' || status === 'dead_letter') {
        this.removeOperation(id);
      } else {
        this.broadcastStatus();
      }
    }
  }

  public removeOperation(id: string): void {
    const op = this.operationsMap.get(id);
    if (op) {
      // Remove from bucket
      this.buckets[op.priority] = this.buckets[op.priority].filter(o => o.id !== id);
      // Remove from map
      this.operationsMap.delete(id);
      this.broadcastStatus();
    }
  }

  public getQueueStats() {
    let total = 0;
    let pending = 0;
    let syncing = 0;
    let failed = 0;

    for (const op of this.operationsMap.values()) {
      total++;
      if (op.status === 'pending') pending++;
      else if (op.status === 'syncing') syncing++;
      else if (op.status === 'failed') failed++;
    }

    return { total, pending, syncing, failed };
  }

  /**
   * Used strictly for Zombie Recovery engine
   */
  public getAllOperations(): QueueOperation[] {
    return Array.from(this.operationsMap.values());
  }

  private broadcastStatus(): void {
    const stats = this.getQueueStats();
    RuntimeEventBus.publish({
      type: 'QUEUE_STATUS_CHANGED',
      payload: {
        pendingCount: stats.pending,
        failedCount: stats.failed,
        syncingCount: stats.syncing,
      }
    });
  }
}

export const SyncQueueService = SyncQueueServiceImpl.getInstance();

import { RuntimeEventBus } from '../services/runtime-event-bus.service';
import { SyncQueueService } from '../services/sync-queue.service';
import { DependencyQueueService } from '../services/dependency-queue.service';

export class QueueGenerator {
  public static start() {
    RuntimeEventBus.subscribe('REPOSITORY_EVENT' as any, (event) => {
      const payload = event.payload;
      
      if (['CREATED', 'UPDATED', 'DELETED'].includes(payload.action)) {
        const actionMap = {
          'CREATED': 'insert',
          'UPDATED': 'update',
          'DELETED': 'delete'
        } as const;

        const isBatch = Array.isArray(payload.data);
        const records = isBatch ? payload.data : [payload.data];
        
        for (const record of records) {
          const operation = {
            id: `sync-op-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: actionMap[payload.action as keyof typeof actionMap],
            entityType: payload.entityType,
            entityId: record.id,
            payload: record,
            createdAt: new Date(),
            priority: payload.entityType === 'gps_points' ? 'background' : 'normal',
            retryCount: 0,
            status: 'pending' as const,
            metadata: {
              tenant_id: record.tenant_id,
              user_id: record.user_id
            }
          };

          // Basic dependency heuristic: Tasks depend on Contacts
          if (payload.entityType === 'tasks' && record.contact_id) {
            DependencyQueueService.enqueue({
              ...operation,
              dependencyId: record.contact_id,
              dependencyType: 'contacts'
            });
          } else {
            SyncQueueService.enqueue(operation);
          }
        }
      }
    });
  }

  private async processQueue() {
    const batch = SyncQueueService.getNextBatch(50);
    if (batch.length === 0) { return; }
  }
}

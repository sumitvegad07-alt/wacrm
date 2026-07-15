import { RuntimeEventBus } from '../services/runtime-event-bus.service';
import { SyncQueueService } from '../services/sync-queue.service';
import { DependencyQueueService } from '../services/dependency-queue.service';

export class QueueGenerator {
  public static start() {
    RuntimeEventBus.subscribe('REPOSITORY_EVENT', (event) => {
      const payload = event.payload;
      
      if (['CREATED', 'UPDATED', 'DELETED'].includes(payload.action)) {
        const actionMap = {
          'CREATED': 'CREATE',
          'UPDATED': 'UPDATE',
          'DELETED': 'DELETE'
        } as const;

        const isBatch = Array.isArray(payload.data);
        const records = isBatch ? payload.data : [payload.data];
        
        for (const record of records) {
          const operation = {
            id: `sync-op-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: actionMap[payload.action as keyof typeof actionMap],
            entity: payload.entityType,
            payload: record,
            priority: payload.entityType === 'gps_points' ? 'background' : 'normal',
            metadata: {
              tenant_id: record.tenant_id || '',
              user_id: record.user_id || '',
              runtime_version: '1.0',
              queue_version: '1.0'
            }
          };

          // Basic dependency heuristic: Tasks depend on Contacts
          if (payload.entityType === 'tasks' && record.contact_id) {
            DependencyQueueService.enqueueDependent({
              ...operation,
              dependencies: [record.contact_id]
            } as any);
          } else {
            SyncQueueService.enqueue(operation as any);
          }
        }
      }
    });
  }

}


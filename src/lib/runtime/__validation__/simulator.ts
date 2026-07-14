import { SyncQueueService } from '../services/sync-queue.service';
import { DependencyQueueService } from '../services/dependency-queue.service';
import { GPSQueueService } from '../services/gps-queue.service';
import { AttachmentQueueService } from '../services/attachment-queue.service';

export class Simulator {
  private static uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  public static getBaseMetadata(tenantId = 'tenant-1', userId = 'user-1') {
    return {
      tenant_id: tenantId,
      user_id: userId,
      session_id: 'sess-123',
      device_id: 'device-abc',
      runtime_version: '1.0.0',
      queue_version: '1.0'
    };
  }

  public static generateWorkload(count: number, type: 'contacts' | 'gps' | 'attachments' | 'mixed', overrideTenantId?: string) {
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'contacts':
          this.queueContact(overrideTenantId);
          break;
        case 'gps':
          this.queueGPS();
          break;
        case 'attachments':
          this.queueAttachment();
          break;
        case 'mixed':
          const rand = Math.random();
          if (rand < 0.25) this.queueContact(overrideTenantId);
          else if (rand < 0.5) this.queueGPS();
          else if (rand < 0.75) this.queueAttachment();
          else this.queueDependentTask(overrideTenantId);
          break;
      }
    }
  }

  private static queueContact(overrideTenantId?: string) {
    SyncQueueService.enqueue({
      id: this.uuidv4(),
      type: 'CREATE',
      entity: 'contacts',
      payload: { name: 'Test Contact', phone: '1234567890' },
      priority: 'normal',
      metadata: this.getBaseMetadata(overrideTenantId)
    });
  }

  private static queueGPS() {
    GPSQueueService.enqueue({
      latitude: Math.random() * 90,
      longitude: Math.random() * 180,
      timestamp: new Date(),
      type: 'ping'
    });
  }

  private static queueAttachment() {
    AttachmentQueueService.enqueue({
      id: this.uuidv4(),
      entityId: this.uuidv4(),
      entityType: 'expense',
      filePath: '/mock/path/image.jpg'
    });
  }

  private static queueDependentTask(overrideTenantId?: string) {
    const contactId = this.uuidv4();
    const taskId = this.uuidv4();
    const meta = this.getBaseMetadata(overrideTenantId);

    SyncQueueService.enqueue({
      id: contactId,
      type: 'CREATE',
      entity: 'contacts',
      payload: { name: 'Dependency Contact' },
      priority: 'high',
      metadata: meta
    });

    DependencyQueueService.enqueueDependent({
      id: taskId,
      type: 'CREATE',
      entity: 'tasks',
      payload: { title: 'Follow up' },
      priority: 'normal',
      dependencies: [contactId],
      metadata: meta
    });
  }
}

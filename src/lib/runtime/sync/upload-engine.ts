import { SyncQueueService } from '../services/sync-queue.service';
import { DeadLetterQueueService } from '../services/dead-letter-queue.service';
import { SyncStatusService } from '../services/sync-status.service';
import { IStorageManager } from '../interfaces/storage.manager';
import { INetworkProvider, SyncOperationPayload } from './network.provider';
import { TelemetryService } from '../services/telemetry.service';

export class UploadEngine {
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  constructor(
    private network: INetworkProvider,
    private storage: IStorageManager
  ) {}

  public start(intervalMs: number = 5000) {
    if (this.isRunning) return;
    this.isRunning = true;
    SyncStatusService.updateState('synchronizing');
    
    this.intervalId = setInterval(() => this.processQueue(), intervalMs);
    // Initial kick
    this.processQueue();
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalId) clearInterval(this.intervalId);
    SyncStatusService.updateState('idle');
  }

  private async processQueue() {
    const batch = SyncQueueService.getPendingOperations().slice(0, 50);
    if (batch.length === 0) {
      SyncStatusService.updateState('idle');
      return;
    }

    SyncStatusService.updateState('synchronizing');
    const startTime = Date.now();

    const payloads: SyncOperationPayload[] = batch.map(op => ({
      id: op.id,
      entityType: op.entity,
      entityId: op.payload?.id || op.id,
      action: op.type === 'CREATE' ? 'insert' : (op.type === 'UPDATE' ? 'update' : 'delete'),
      data: op.payload,
      timestamp: op.createdAt.getTime()
    }));

    try {
      const result = await this.network.uploadBatch(payloads);

      if (result.success) {
        // Mark as synced locally
        await this.storage.batch(
          batch.map(op => ({
            action: 'update',
            collection: op.entity,
            id: op.payload?.id || op.id,
            data: { sync_status: 'synced', sync_version: (op.payload.sync_version || 0) + 1 }
          }))
        );

        batch.forEach(op => SyncQueueService.removeOperation(op.id));
        TelemetryService.logSyncDuration(Date.now() - startTime);
      } else {
        this.handleFailures(batch, result.errors ?? []);
      }
    } catch (e) {
      this.handleFailures(batch, [e]);
    }
  }

  private handleFailures(batch: any[], errors: any[]) {
    batch.forEach(op => {
      if (op.retryCount >= 3) {
        SyncQueueService.removeOperation(op.id);
        DeadLetterQueueService.pushToDLQ(op, errors[0]?.message || 'Unknown error');
      } else {
        op.retryCount += 1;
        SyncQueueService.updateOperationStatus(op.id, 'failed', errors[0]?.message);
      }
    });
    TelemetryService.logError(`Batch upload failed for ${batch.length} items`);
  }
}

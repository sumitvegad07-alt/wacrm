import { INetworkProvider } from './network.provider';
import { IStorageManager } from '../interfaces/storage.manager';
import { ConflictResolutionEngine } from './conflict-resolution.engine';
import { TelemetryService } from '../services/telemetry.service';
import { RuntimeEventBus } from '../services/runtime-event-bus.service';

export class DownloadEngine {
  private lastFetchCursor: number = 0;

  constructor(
    private network: INetworkProvider,
    private storage: IStorageManager
  ) {}

  public async fetchDeltas() {
    const startTime = Date.now();
    try {
      const deltas = await this.network.fetchDeltas(this.lastFetchCursor);
      
      if (deltas.length === 0) return;

      const ops = [];
      
      for (const delta of deltas) {
        // Fetch local state for conflict check
        const local = await this.storage.find(delta.entityType, delta.data.id);
        
        const resolution = ConflictResolutionEngine.resolve(local, delta.data);
        
        if (resolution === 'server_wins') {
          ops.push({
            action: delta.action === 'delete' ? 'delete' : 'upsert',
            collection: delta.entityType,
            id: delta.data.id,
            data: { ...delta.data, sync_status: 'synced' } // Mark as fully synced locally
          });
        }
      }

      if (ops.length > 0) {
        // Apply deltas directly to storage, bypassing Repo events since they are already synced
        await this.storage.transaction(async (tx) => {
          await tx.batch(ops as any);
        });
        
        // Notify Repositories so UI can refresh
        ops.forEach(op => {
          RuntimeEventBus.publish({
            type: 'REPOSITORY_EVENT',
            payload: {
              entityType: op.collection,
              action: op.action === 'delete' ? 'DELETED' : 'UPDATED',
              data: { id: op.id },
              timestamp: new Date()
            }
          } as any);
        });

        TelemetryService.logSyncDuration(Date.now() - startTime);
      }

      this.lastFetchCursor = Date.now();
    } catch (e) {
      TelemetryService.logError(e as Error);
      console.error('Download delta fetch failed', e);
    }
  }
}

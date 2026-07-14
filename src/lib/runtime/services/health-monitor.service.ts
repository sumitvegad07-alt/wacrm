import { RuntimeEventBus } from './runtime-event-bus.service';
import { SyncQueueService } from './sync-queue.service';
import { NetworkMonitorService } from './network-monitor.service';
import { IStorageManager } from '../interfaces/storage.manager';

export class HealthMonitorServiceImpl {
  private static instance: HealthMonitorServiceImpl;
  private storageManager: IStorageManager | null = null;
  private intervalId: any;

  private constructor() {}

  public static getInstance(): HealthMonitorServiceImpl {
    if (!HealthMonitorServiceImpl.instance) {
      HealthMonitorServiceImpl.instance = new HealthMonitorServiceImpl();
    }
    return HealthMonitorServiceImpl.instance;
  }

  public registerStorage(storageManager: IStorageManager) {
    this.storageManager = storageManager;
  }

  public startMonitoring(intervalMs: number = 60000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      await this.checkHealth();
    }, intervalMs);
  }

  public stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  public async checkHealth(): Promise<void> {
    const queueStats = SyncQueueService.getQueueStats();
    const networkState = NetworkMonitorService.getState();
    const issues: string[] = [];

    if (queueStats.failed > 10) issues.push('High number of failed sync operations');
    if (queueStats.pending > 100) issues.push('Large sync queue buildup');

    let storageUsage = 0;
    if (this.storageManager) {
      try {
        storageUsage = await this.storageManager.getStorageUsage();
        if (storageUsage > 50 * 1024 * 1024) { // > 50MB
          issues.push('High storage usage');
        }
      } catch (e) {
        issues.push('Failed to check storage usage');
      }
    }

    RuntimeEventBus.publish({
      type: 'HEALTH_STATUS_REPORT',
      payload: {
        isHealthy: issues.length === 0,
        network: networkState,
        queueSize: queueStats.total,
        storageUsageBytes: storageUsage,
        issues
      }
    });
  }
}

export const HealthMonitorService = HealthMonitorServiceImpl.getInstance();

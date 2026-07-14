import { SyncQueueService } from './sync-queue.service';
import { TelemetryService } from './telemetry.service';
import { RuntimeConfig, DefaultRuntimeConfig } from '../types/config';

export class RuntimeRecoveryServiceImpl {
  private static instance: RuntimeRecoveryServiceImpl;
  private config: RuntimeConfig['recovery'] = DefaultRuntimeConfig.recovery;

  private constructor() {}

  public static getInstance(): RuntimeRecoveryServiceImpl {
    if (!RuntimeRecoveryServiceImpl.instance) {
      RuntimeRecoveryServiceImpl.instance = new RuntimeRecoveryServiceImpl();
    }
    return RuntimeRecoveryServiceImpl.instance;
  }

  public setConfig(config: RuntimeConfig['recovery']): void {
    this.config = config;
  }

  /**
   * Scans the durable queue for orphaned operations stuck in 'syncing'.
   * Reverts them to 'pending' if their last update was beyond the Zombie Timeout.
   */
  public recoverZombies(): number {
    const allOps = SyncQueueService.getAllOperations();
    const now = new Date().getTime();
    let recoveredCount = 0;

    for (const op of allOps) {
      if (op.status === 'syncing') {
        const timeSinceUpdate = now - op.updatedAt.getTime();
        if (timeSinceUpdate > this.config.zombieTimeoutMs) {
          console.warn(`[RecoveryEngine] Recovering Zombie Operation ${op.id}`);
          SyncQueueService.updateOperationStatus(op.id, 'pending', 'Recovered from zombie state');
          recoveredCount++;
        }
      }
    }

    if (recoveredCount > 0) {
      TelemetryService.logRecovery(recoveredCount);
    }
    
    return recoveredCount;
  }
}

export const RuntimeRecoveryService = RuntimeRecoveryServiceImpl.getInstance();

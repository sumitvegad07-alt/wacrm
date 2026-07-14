import { SyncStatusService } from './services/sync-status.service';
import { SyncQueueService } from './services/sync-queue.service';
import { DependencyQueueService } from './services/dependency-queue.service';
import { HealthMonitorService } from './services/health-monitor.service';
import { GPSQueueService } from './services/gps-queue.service';
import { AttachmentQueueService } from './services/attachment-queue.service';
import { DeadLetterQueueService } from './services/dead-letter-queue.service';
import { RuntimeRecoveryService } from './services/runtime-recovery.service';
import { TelemetryService } from './services/telemetry.service';
import { TransactionManagerService } from './services/transaction-manager.service';

import { IStorageManager } from './interfaces/storage.manager';
import { IConnectivityProvider } from './interfaces/connectivity.provider';
import { IAuthProvider } from './interfaces/auth.provider';
import { DefaultRuntimeConfig, RuntimeConfig } from './types/config';

// EWO-005 Integrations
import { QueueGenerator } from './sync/queue-generator';
import { UploadEngine } from './sync/upload-engine';
import { DownloadEngine } from './sync/download-engine';
import { BackgroundSyncEngine } from './sync/background-sync';
import { SupabaseNetworkProvider } from './sync/supabase/supabase-network.provider';

export interface RuntimeDependencies {
  storage: IStorageManager;
  connectivity: IConnectivityProvider;
  auth: IAuthProvider;
  config?: Partial<RuntimeConfig>;
}

/**
 * SyncCenter Facade
 * 
 * Aggregates all Enterprise Hardened Platform Services.
 */
export class SyncCenterFacade {
  private static instance: SyncCenterFacade;
  private connectivity: IConnectivityProvider | null = null;
  private config: RuntimeConfig = DefaultRuntimeConfig;

  public uploadEngine?: UploadEngine;
  public downloadEngine?: DownloadEngine;
  public backgroundSyncEngine?: BackgroundSyncEngine;

  private constructor() {}

  public static getInstance(): SyncCenterFacade {
    if (!SyncCenterFacade.instance) {
      SyncCenterFacade.instance = new SyncCenterFacade();
    }
    return SyncCenterFacade.instance;
  }

  public initializePlatform(deps: RuntimeDependencies) {
    this.config = { ...DefaultRuntimeConfig, ...deps.config };

    // Dependency Injection
    this.connectivity = deps.connectivity;
    HealthMonitorService.registerStorage(deps.storage);
    TransactionManagerService.registerStorage(deps.storage);
    SyncQueueService.registerAuthProvider(deps.auth);

    // Engine Startups
    this.connectivity.start();
    HealthMonitorService.startMonitoring(this.config.telemetry.reportIntervalMs);
    
    // EWO-005/006 Synchronization Startup
    QueueGenerator.start();
    const network = new SupabaseNetworkProvider();
    network.setAuthProvider(deps.auth); // Inject real auth constraint
    
    this.uploadEngine = new UploadEngine(network, deps.storage);
    this.downloadEngine = new DownloadEngine(network, deps.storage);
    this.backgroundSyncEngine = new BackgroundSyncEngine(this.connectivity, this.uploadEngine, this.downloadEngine);
    
    // Start background listener
    this.backgroundSyncEngine.start();

    // Recovery Boot Routine
    RuntimeRecoveryService.setConfig(this.config.recovery);
    RuntimeRecoveryService.recoverZombies();
  }

  public getSyncCenterData() {
    const queueStats = SyncQueueService.getQueueStats();
    
    return {
      currentStatus: SyncStatusService.getState(),
      networkStatus: this.connectivity?.getState() || 'unknown',
      
      pendingQueueCount: queueStats.pending,
      failedQueueCount: queueStats.failed,
      syncingQueueCount: queueStats.syncing,
      deadLetterCount: DeadLetterQueueService.getCount(),
      dependentQueueCount: DependencyQueueService.getWaitingCount(),
      
      gpsQueueCount: GPSQueueService.getQueueStats().pending,
      attachmentQueueCount: AttachmentQueueService.getQueueStats().pending,
      
      telemetry: TelemetryService.getReport()
    };
  }

  public stopPlatform() {
    this.connectivity?.stop();
    HealthMonitorService.stopMonitoring();
    this.uploadEngine?.stop();
    this.backgroundSyncEngine?.stop();
  }
}

export const SyncCenter = SyncCenterFacade.getInstance();

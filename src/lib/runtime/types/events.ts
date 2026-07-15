export type NetworkState = 'online' | 'offline';
export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'unknown';

export interface ConnectivityEvent {
  type: 'CONNECTIVITY_CHANGED';
  payload: {
    state: NetworkState;
    quality: NetworkQuality;
  };
}

export type SyncState = 'idle' | 'pending' | 'synchronizing' | 'failed' | 'offline';

export interface SyncStatusEvent {
  type: 'SYNC_STATUS_CHANGED';
  payload: {
    state: SyncState;
    message?: string;
  };
}

export interface QueueStatusEvent {
  type: 'QUEUE_STATUS_CHANGED';
  payload: {
    pendingCount: number;
    failedCount: number;
    syncingCount: number;
  };
}

export interface HealthStatusEvent {
  type: 'HEALTH_STATUS_REPORT';
  payload: {
    isHealthy: boolean;
    network: NetworkState;
    storageUsageBytes?: number;
    queueSize: number;
    lastSyncTime?: Date;
    issues: string[];
  };
}

export interface TelemetryMetrics {
  averageSyncDurationMs: number;
  totalRetries: number;
  recentErrors: Array<{ message: string; timestamp: Date }>;
  deadLetterCount: number;
  recoveryCount: number;
  zombiesRecovered: number;
}

export interface RepositoryBridgeEvent {
  type: 'REPOSITORY_EVENT'; // e.g. 'REPOSITORY_EVENT'
  payload: {
    entityType: string;
    action: 'CREATED' | 'UPDATED' | 'DELETED' | 'RESTORED';
    data: any;
    timestamp: Date;
  };
}

export type RuntimeEvent = 
  | ConnectivityEvent
  | SyncStatusEvent
  | QueueStatusEvent
  | HealthStatusEvent
  | RepositoryBridgeEvent;

export interface RuntimeConfig {
  retry: {
    baseDelayMs: number;
    maxRetries: number;
    maxJitterMs: number;
  };
  recovery: {
    zombieTimeoutMs: number; // How long before a 'syncing' item is considered a zombie
  };
  telemetry: {
    enabled: boolean;
    reportIntervalMs: number;
  };
  queue: {
    maxSize: number;
  };
  versions: {
    runtimeVersion: string;
    queueSchemaVersion: string;
    protocolVersion: string;
  };
}

export const DefaultRuntimeConfig: RuntimeConfig = {
  retry: {
    baseDelayMs: 1000,
    maxRetries: 5,
    maxJitterMs: 1000,
  },
  recovery: {
    zombieTimeoutMs: 5 * 60 * 1000, // 5 minutes
  },
  telemetry: {
    enabled: true,
    reportIntervalMs: 60000,
  },
  queue: {
    maxSize: 100000,
  },
  versions: {
    runtimeVersion: '1.0.0',
    queueSchemaVersion: '1.0',
    protocolVersion: '1',
  }
};

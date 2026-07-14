import { TelemetryMetrics } from '../types/events';

export class TelemetryServiceImpl {
  private static instance: TelemetryServiceImpl;
  private metrics: TelemetryMetrics = {
    averageSyncDurationMs: 0,
    totalRetries: 0,
    recentErrors: [],
    deadLetterCount: 0,
    recoveryCount: 0,
    zombiesRecovered: 0
  };

  private syncDurations: number[] = [];

  private constructor() {}

  public static getInstance(): TelemetryServiceImpl {
    if (!TelemetryServiceImpl.instance) {
      TelemetryServiceImpl.instance = new TelemetryServiceImpl();
    }
    return TelemetryServiceImpl.instance;
  }

  public logSyncDuration(durationMs: number): void {
    this.syncDurations.push(durationMs);
    if (this.syncDurations.length > 100) this.syncDurations.shift();
    
    const total = this.syncDurations.reduce((a, b) => a + b, 0);
    this.metrics.averageSyncDurationMs = total / this.syncDurations.length;
  }

  public incrementRetry(): void {
    this.metrics.totalRetries++;
  }

  public logError(error: Error | string): void {
    const message = error instanceof Error ? error.message : error;
    this.metrics.recentErrors.push({ message, timestamp: new Date() });
    if (this.metrics.recentErrors.length > 50) this.metrics.recentErrors.shift();
  }

  public logRecovery(count: number): void {
    this.metrics.recoveryCount++;
    this.metrics.zombiesRecovered += count;
  }

  public logDeadLetter(): void {
    this.metrics.deadLetterCount++;
  }

  public getReport(): TelemetryMetrics {
    return this.metrics;
  }
}

export const TelemetryService = TelemetryServiceImpl.getInstance();

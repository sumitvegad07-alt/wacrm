import { QueueOperation } from '../types/queue';
import { RuntimeConfig, DefaultRuntimeConfig } from '../types/config';

export class RetryManagerServiceImpl {
  private static instance: RetryManagerServiceImpl;
  private config: RuntimeConfig['retry'] = DefaultRuntimeConfig.retry;

  private constructor() {}

  public static getInstance(): RetryManagerServiceImpl {
    if (!RetryManagerServiceImpl.instance) {
      RetryManagerServiceImpl.instance = new RetryManagerServiceImpl();
    }
    return RetryManagerServiceImpl.instance;
  }

  public setConfig(config: RuntimeConfig['retry']): void {
    this.config = config;
  }

  /**
   * Calculates the next retry delay using exponential backoff + Jitter.
   * delay = (base * 2^retry) + random(0, maxJitter)
   * This prevents Thundering Herd DDoS if many devices come online simultaneously.
   */
  public getBackoffDelay(retryCount: number): number {
    const exponentialBase = this.config.baseDelayMs * Math.pow(2, retryCount);
    const jitter = Math.random() * this.config.maxJitterMs;
    return exponentialBase + jitter;
  }

  public shouldRetry(operation: QueueOperation, errorClass: 'permanent' | 'temporary'): boolean {
    if (errorClass === 'permanent') {
      return false;
    }
    return operation.retryCount < this.config.maxRetries;
  }

  public getNextRetryTime(operation: QueueOperation): Date {
    const delay = this.getBackoffDelay(operation.retryCount);
    return new Date(Date.now() + delay);
  }
}

export const RetryManagerService = RetryManagerServiceImpl.getInstance();

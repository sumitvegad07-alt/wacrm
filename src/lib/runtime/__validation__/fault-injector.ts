import { RuntimeEventBus } from '../services/runtime-event-bus.service';

export class FaultInjector {
  private static instance: FaultInjector;
  
  private storageFailureRate = 0;
  private isNetworkDown = false;
  private storageFailureType: 'temporary' | 'permanent' = 'temporary';

  private constructor() {}

  public static getInstance(): FaultInjector {
    if (!FaultInjector.instance) {
      FaultInjector.instance = new FaultInjector();
    }
    return FaultInjector.instance;
  }

  /**
   * Probability between 0.0 and 1.0 that a storage operation throws
   */
  public setStorageFailureRate(rate: number, type: 'temporary' | 'permanent' = 'temporary') {
    this.storageFailureRate = rate;
    this.storageFailureType = type;
  }

  /**
   * Forces a fake network event on the Event Bus, overriding actual NetworkMonitorService state
   */
  public toggleNetwork(isDown: boolean) {
    this.isNetworkDown = isDown;
    RuntimeEventBus.publish({
      type: 'CONNECTIVITY_CHANGED',
      payload: {
        state: isDown ? 'offline' : 'online',
        quality: 'unknown'
      }
    });
  }

  /**
   * Generates multiple dummy events to saturate the Event Bus
   */
  public saturateEventBus(count: number) {
    for (let i = 0; i < count; i++) {
      RuntimeEventBus.publish({
        type: 'HEALTH_STATUS_REPORT',
        payload: {
          isHealthy: true,
          network: 'online',
          queueSize: 0,
          issues: ['dummy event']
        }
      });
    }
  }

  /**
   * Throws if failure rate dictates it
   */
  public checkStorageFaults() {
    if (this.storageFailureRate > 0) {
      if (Math.random() < this.storageFailureRate) {
        if (this.storageFailureType === 'temporary') {
          throw new Error('Injected Temporary Storage Fault (e.g. timeout, locked db)');
        } else {
          throw new Error('Injected Permanent Storage Fault (e.g. disk full, corruption)');
        }
      }
    }
  }

  public reset() {
    this.storageFailureRate = 0;
    this.isNetworkDown = false;
  }
}

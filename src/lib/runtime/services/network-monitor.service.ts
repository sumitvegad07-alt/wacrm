import { INetworkMonitorService } from '../interfaces/network.monitor';
import { NetworkState, NetworkQuality } from '../types/events';
import { RuntimeEventBus } from './runtime-event-bus.service';

class NetworkMonitorServiceImpl implements INetworkMonitorService {
  private static instance: NetworkMonitorServiceImpl;
  
  private currentState: NetworkState = 'online';
  private currentQuality: NetworkQuality = 'unknown';
  private isMonitoring: boolean = false;

  private constructor() {
    // Default assumptions for SSR environments, updated when mounted in browser
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      this.currentState = navigator.onLine ? 'online' : 'offline';
    }

    // Subscribe to forced network changes from Fault Injectors or external sources
    RuntimeEventBus.subscribe('CONNECTIVITY_CHANGED', (event) => {
      if (event.payload.state !== this.currentState) {
        this.currentState = event.payload.state;
      }
    });
  }

  public static getInstance(): NetworkMonitorServiceImpl {
    if (!NetworkMonitorServiceImpl.instance) {
      NetworkMonitorServiceImpl.instance = new NetworkMonitorServiceImpl();
    }
    return NetworkMonitorServiceImpl.instance;
  }

  public start(): void {
    if (this.isMonitoring || typeof window === 'undefined') return;

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.isMonitoring = true;
    
    // Broadcast initial state
    this.broadcastState();
  }

  public stop(): void {
    if (!this.isMonitoring || typeof window === 'undefined') return;

    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.isMonitoring = false;
  }

  public getState(): NetworkState {
    return this.currentState;
  }

  public getQuality(): NetworkQuality {
    // Advanced implementations could use navigator.connection
    return this.currentQuality;
  }

  public isOnline(): boolean {
    return this.currentState === 'online';
  }

  private handleOnline = () => {
    this.currentState = 'online';
    this.broadcastState();
  };

  private handleOffline = () => {
    this.currentState = 'offline';
    this.broadcastState();
  };

  private broadcastState(): void {
    RuntimeEventBus.publish({
      type: 'CONNECTIVITY_CHANGED',
      payload: {
        state: this.currentState,
        quality: this.currentQuality
      }
    });
  }
}

export const NetworkMonitorService = NetworkMonitorServiceImpl.getInstance();

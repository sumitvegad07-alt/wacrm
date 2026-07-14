import { NetworkState, NetworkQuality } from '../types/events';

export interface INetworkMonitorService {
  /**
   * Starts monitoring network status
   */
  start(): void;

  /**
   * Stops monitoring network status
   */
  stop(): void;

  /**
   * Returns the current network state
   */
  getState(): NetworkState;

  /**
   * Returns the current network quality estimate
   */
  getQuality(): NetworkQuality;

  /**
   * Returns true if currently online
   */
  isOnline(): boolean;
}

import { NetworkState, NetworkQuality } from '../types/events';

export interface IConnectivityProvider {
  /**
   * Initializes the connectivity monitor
   */
  start(): void;

  /**
   * Stops the connectivity monitor
   */
  stop(): void;

  /**
   * Returns the current state
   */
  getState(): NetworkState;

  /**
   * Returns network quality estimate
   */
  getQuality(): NetworkQuality;
}

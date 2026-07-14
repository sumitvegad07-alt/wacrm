import { IConnectivityProvider } from '../interfaces/connectivity.provider';
import { NetworkState, NetworkQuality } from '../types/events';

export class MockConnectivityProvider implements IConnectivityProvider {
  private state: NetworkState = 'online';

  public setState(state: NetworkState) {
    this.state = state;
  }

  start(): void {}
  stop(): void {}
  
  getState(): NetworkState {
    return this.state;
  }
  
  getQuality(): NetworkQuality {
    return 'good';
  }
}

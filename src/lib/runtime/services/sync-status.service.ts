import { SyncState } from '../types/events';
import { RuntimeEventBus } from './runtime-event-bus.service';

class SyncStatusServiceImpl {
  private static instance: SyncStatusServiceImpl;
  private currentState: SyncState = 'idle';

  private constructor() {
    // Listen for connectivity changes to potentially update sync state
    RuntimeEventBus.subscribe('CONNECTIVITY_CHANGED', (event) => {
      if (event.payload.state === 'offline') {
        this.updateState('offline', 'Network is offline');
      } else if (this.currentState === 'offline') {
        this.updateState('idle', 'Network restored');
      }
    });
  }

  public static getInstance(): SyncStatusServiceImpl {
    if (!SyncStatusServiceImpl.instance) {
      SyncStatusServiceImpl.instance = new SyncStatusServiceImpl();
    }
    return SyncStatusServiceImpl.instance;
  }

  public getState(): SyncState {
    return this.currentState;
  }

  public updateState(newState: SyncState, message?: string): void {
    if (this.currentState !== newState) {
      this.currentState = newState;
      RuntimeEventBus.publish({
        type: 'SYNC_STATUS_CHANGED',
        payload: {
          state: newState,
          message
        }
      });
    }
  }
}

export const SyncStatusService = SyncStatusServiceImpl.getInstance();

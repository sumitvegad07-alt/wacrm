export interface GlobalSyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingUploads: number;
  lastSyncTime?: number;
  syncErrors: number;
}

/**
 * Abstraction layer over Runtime sync mechanics.
 * The UI consumes this instead of Runtime directly.
 */
export class ApplicationSyncService {
  private static listeners: Set<(state: GlobalSyncState) => void> = new Set();
  private static currentState: GlobalSyncState = {
    isOnline: true,
    isSyncing: false,
    pendingUploads: 0,
    syncErrors: 0
  };

  public static subscribe(listener: (state: GlobalSyncState) => void) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Called by a bridge or SyncCenter when state changes
  public static updateState(partial: Partial<GlobalSyncState>) {
    this.currentState = { ...this.currentState, ...partial };
    this.listeners.forEach(l => l(this.currentState));
  }
}

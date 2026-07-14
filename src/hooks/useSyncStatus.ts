import { useState, useEffect } from 'react';
import { ApplicationSyncService, GlobalSyncState } from '../lib/application/services/sync/ApplicationSyncService';

export const useSyncStatus = () => {
  const [syncState, setSyncState] = useState<GlobalSyncState>({
    isOnline: true,
    isSyncing: false,
    pendingUploads: 0,
    syncErrors: 0
  });

  useEffect(() => {
    const unsubscribe = ApplicationSyncService.subscribe((state) => {
      setSyncState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return syncState;
};

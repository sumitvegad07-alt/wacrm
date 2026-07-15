import { IConnectivityProvider } from '../interfaces/connectivity.provider';
import { UploadEngine } from './upload-engine';
import { DownloadEngine } from './download-engine';
import { RuntimeEventBus } from '../services/runtime-event-bus.service';

export class BackgroundSyncEngine {
  private isOnline: boolean = false;
  private backgroundInterval?: NodeJS.Timeout;

  constructor(
    private connectivity: IConnectivityProvider,
    private uploadEngine: UploadEngine,
    private downloadEngine: DownloadEngine
  ) {}

  public start() {
    this.isOnline = this.connectivity.getState() === 'online';

    // Hook into Network connectivity restorations
    RuntimeEventBus.subscribe('CONNECTIVITY_CHANGED', (event) => {
      const state = event.payload.state;
      const wasOffline = !this.isOnline;
      this.isOnline = state === 'online';

      if (wasOffline && this.isOnline) {
        this.triggerImmediateSync();
      }
    });

    // Background interval sync (e.g. every 5 minutes)
    this.backgroundInterval = setInterval(() => {
      if (this.isOnline) {
        this.triggerImmediateSync();
      }
    }, 5 * 60 * 1000);
  }

  public stop() {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
    }
  }

  public triggerImmediateSync() {
    if (!this.isOnline) return;

    // Run Download Delta Fetch first to resolve server updates before pushing our local queue
    this.downloadEngine.fetchDeltas().then(() => {
      // Then trigger the upload engine to clear the queue
      this.uploadEngine.start(2000); // Poll fast for a bit
    });
  }
}

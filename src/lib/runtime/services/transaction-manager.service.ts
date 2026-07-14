import { IStorageManager } from '../interfaces/storage.manager';
import { SerializableIntent } from '../types/queue';

export class TransactionManagerServiceImpl {
  private static instance: TransactionManagerServiceImpl;
  private storageManager: IStorageManager | null = null;

  private constructor() {}

  public static getInstance(): TransactionManagerServiceImpl {
    if (!TransactionManagerServiceImpl.instance) {
      TransactionManagerServiceImpl.instance = new TransactionManagerServiceImpl();
    }
    return TransactionManagerServiceImpl.instance;
  }

  public registerStorage(storageManager: IStorageManager): void {
    this.storageManager = storageManager;
  }

  /**
   * Executes a series of Serializable Intents.
   * By accepting JSON intents instead of executable closures (`() => Promise<void>`),
   * the TransactionManager can be passed across Web Worker or React Native background thread boundaries.
   */
  public async executeIntents(intents: SerializableIntent[]): Promise<boolean> {
    if (!this.storageManager) {
      console.warn('TransactionManager: StorageManager not registered.');
      return false;
    }

    try {
      // The storage provider is now responsible for translating JSON intents into SQL/Watermelon calls atomically.
      // We will simulate this translation logic passing to the mock storage layer for validation.
      
      const executableOperations = intents.map(intent => async () => {
        // This is a bridge. In reality, the StorageProvider's own `executeTransaction` 
        // would take the raw intents, not closures. But for the sake of not breaking the 
        // mock storage interface today, we map them here.
        if (intent.action === 'CREATE' || intent.action === 'UPDATE') {
          await this.storageManager!.save(intent.entity, intent.data.id, intent.data);
        } else if (intent.action === 'DELETE') {
          await this.storageManager!.remove(intent.entity, intent.data.id);
        }
      });

      await this.storageManager.executeTransaction(executableOperations);
      return true;
    } catch (e) {
      console.error('TransactionManager: Atomic transaction failed', e);
      return false;
    }
  }
}

export const TransactionManagerService = TransactionManagerServiceImpl.getInstance();

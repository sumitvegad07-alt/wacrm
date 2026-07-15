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
      
      const operations: Array<{ action: 'insert'|'update'|'delete', collection: string, id: string, data?: any }> = intents.map(intent => {
        return {
          action: intent.action === 'DELETE' ? 'delete' : (intent.action === 'UPDATE' ? 'update' : 'insert'),
          collection: intent.entity,
          id: intent.data.id,
          data: intent.action === 'DELETE' ? undefined : intent.data
        };
      });

      await this.storageManager.batch(operations);
      return true;
    } catch (e) {
      console.error('TransactionManager: Atomic transaction failed', e);
      return false;
    }
  }
}

export const TransactionManagerService = TransactionManagerServiceImpl.getInstance();

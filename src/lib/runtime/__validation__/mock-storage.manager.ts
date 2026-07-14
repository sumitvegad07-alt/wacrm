import { IStorageManager } from '../interfaces/storage.manager';
import { FaultInjector } from './fault-injector';

export class MockStorageManager implements IStorageManager {
  private data: Map<string, Map<string, any>> = new Map();
  private latencyMs: number = 0;

  public setSimulatedLatency(ms: number) {
    this.latencyMs = ms;
  }

  private async delay() {
    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }
  }

  private getCollection(collection: string) {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    return this.data.get(collection)!;
  }

  async initialize(): Promise<void> {
    await this.delay();
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    return (coll.get(id) as T) || null;
  }

  async query<T>(collection: string, queryParams?: any): Promise<T[]> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    return Array.from(coll.values()) as T[];
  }

  async save<T>(collection: string, id: string, data: T): Promise<void> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    coll.set(id, JSON.parse(JSON.stringify(data)));
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.delay();
    FaultInjector.getInstance().checkStorageFaults();
    const coll = this.getCollection(collection);
    coll.delete(id);
  }

  async clear(collection: string): Promise<void> {
    await this.delay();
    this.data.delete(collection);
  }

  async executeTransaction(operations: Array<() => Promise<void>>): Promise<void> {
    // Basic rollback simulation
    const snapshot = this.createSnapshot();
    try {
      for (const op of operations) {
        await op();
      }
    } catch (e) {
      this.restoreSnapshot(snapshot);
      throw e;
    }
  }

  async getStorageUsage(): Promise<number> {
    // Roughly calculate memory used by the maps
    let size = 0;
    for (const [colName, col] of this.data.entries()) {
      size += colName.length;
      for (const [id, val] of col.entries()) {
        size += id.length;
        size += JSON.stringify(val).length;
      }
    }
    return size;
  }

  private createSnapshot() {
    const snapshot = new Map<string, Map<string, any>>();
    for (const [colName, col] of this.data.entries()) {
      const clonedCol = new Map();
      for (const [id, val] of col.entries()) {
        clonedCol.set(id, JSON.parse(JSON.stringify(val)));
      }
      snapshot.set(colName, clonedCol);
    }
    return snapshot;
  }

  private restoreSnapshot(snapshot: Map<string, Map<string, any>>) {
    this.data = snapshot;
  }
}

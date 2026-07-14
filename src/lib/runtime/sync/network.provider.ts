export interface SyncOperationPayload {
  id: string;
  entityType: string;
  entityId: string;
  action: 'insert' | 'update' | 'delete';
  data: any;
  timestamp: number;
}

export interface INetworkProvider {
  uploadBatch(operations: SyncOperationPayload[]): Promise<{ success: boolean; errors?: any[] }>;
  fetchDeltas(since: number): Promise<{ entityType: string; action: 'insert'|'update'|'delete'; data: any }[]>;
}

export class MockNetworkProvider implements INetworkProvider {
  public async uploadBatch(operations: SyncOperationPayload[]) {
    // Simulate latency
    await new Promise(r => setTimeout(r, 10));
    // Simulate 99% success rate
    if (Math.random() > 0.99) {
      return { success: false, errors: [new Error('Network simulated failure')] };
    }
    return { success: true };
  }

  public async fetchDeltas(since: number) {
    await new Promise(r => setTimeout(r, 10));
    return []; // Mock no new server changes
  }
}

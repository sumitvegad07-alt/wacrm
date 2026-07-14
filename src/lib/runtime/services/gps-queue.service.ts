export interface GPSOperation {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
  type: 'visit' | 'attendance' | 'ping';
  status: 'pending' | 'syncing' | 'failed' | 'completed';
}

export class GPSQueueServiceImpl {
  private static instance: GPSQueueServiceImpl;
  private queue: GPSOperation[] = [];

  private constructor() {}

  public static getInstance(): GPSQueueServiceImpl {
    if (!GPSQueueServiceImpl.instance) {
      GPSQueueServiceImpl.instance = new GPSQueueServiceImpl();
    }
    return GPSQueueServiceImpl.instance;
  }

  public enqueue(operation: Omit<GPSOperation, 'status' | 'id'>): void {
    this.queue.push({
      ...operation,
      id: crypto.randomUUID(),
      status: 'pending'
    });
  }

  public getQueueStats() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(op => op.status === 'pending').length,
    };
  }
}

export const GPSQueueService = GPSQueueServiceImpl.getInstance();

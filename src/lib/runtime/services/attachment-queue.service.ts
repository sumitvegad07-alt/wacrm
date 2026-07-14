export interface AttachmentOperation {
  id: string;
  filePath: string;
  entityId: string;
  entityType: string;
  status: 'pending' | 'uploading' | 'failed' | 'completed';
  retryCount: number;
}

export class AttachmentQueueServiceImpl {
  private static instance: AttachmentQueueServiceImpl;
  private queue: AttachmentOperation[] = [];

  private constructor() {}

  public static getInstance(): AttachmentQueueServiceImpl {
    if (!AttachmentQueueServiceImpl.instance) {
      AttachmentQueueServiceImpl.instance = new AttachmentQueueServiceImpl();
    }
    return AttachmentQueueServiceImpl.instance;
  }

  public enqueue(operation: Omit<AttachmentOperation, 'status' | 'retryCount'>): void {
    this.queue.push({
      ...operation,
      status: 'pending',
      retryCount: 0
    });
  }

  public getQueueStats() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(op => op.status === 'pending').length,
    };
  }
}

export const AttachmentQueueService = AttachmentQueueServiceImpl.getInstance();

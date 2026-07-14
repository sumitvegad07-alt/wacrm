import { QueueOperation } from '../types/queue';

export class DeadLetterQueueServiceImpl {
  private static instance: DeadLetterQueueServiceImpl;
  private deadLetters: Map<string, QueueOperation> = new Map();

  private constructor() {}

  public static getInstance(): DeadLetterQueueServiceImpl {
    if (!DeadLetterQueueServiceImpl.instance) {
      DeadLetterQueueServiceImpl.instance = new DeadLetterQueueServiceImpl();
    }
    return DeadLetterQueueServiceImpl.instance;
  }

  public pushToDLQ(operation: QueueOperation, finalError: string): void {
    operation.status = 'dead_letter';
    operation.error = finalError;
    operation.updatedAt = new Date();
    this.deadLetters.set(operation.id, operation);
    console.error(`[DLQ] Operation ${operation.id} moved to Dead Letter Queue: ${finalError}`);
  }

  public getDeadLetters(): QueueOperation[] {
    return Array.from(this.deadLetters.values());
  }

  public purge(operationId: string): void {
    this.deadLetters.delete(operationId);
  }

  public getCount(): number {
    return this.deadLetters.size;
  }
}

export const DeadLetterQueueService = DeadLetterQueueServiceImpl.getInstance();

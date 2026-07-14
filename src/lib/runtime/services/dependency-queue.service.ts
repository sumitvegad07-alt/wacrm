import { QueueOperation } from '../types/queue';
import { SyncQueueService } from './sync-queue.service';

export class InvalidGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGraphError';
  }
}

export class DependencyQueueServiceImpl {
  private static instance: DependencyQueueServiceImpl;
  
  // Holds operations that are waiting for dependencies to resolve
  private waitingQueue: Map<string, Omit<QueueOperation, 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>> = new Map();

  private constructor() {}

  public static getInstance(): DependencyQueueServiceImpl {
    if (!DependencyQueueServiceImpl.instance) {
      DependencyQueueServiceImpl.instance = new DependencyQueueServiceImpl();
    }
    return DependencyQueueServiceImpl.instance;
  }

  /**
   * Enqueues an operation, validating that its dependencies don't create a cycle.
   */
  public enqueueDependent(operation: Omit<QueueOperation, 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>): void {
    if (!operation.dependencies || operation.dependencies.length === 0) {
      // No dependencies, forward directly to main sync queue
      SyncQueueService.enqueue(operation);
      return;
    }

    if (operation.dependencies.includes(operation.id)) {
      throw new InvalidGraphError(`Operation ${operation.id} cannot depend on itself.`);
    }

    // Temporary graph addition for cycle detection
    this.waitingQueue.set(operation.id, operation);
    
    if (this.detectCycle(operation.id)) {
      this.waitingQueue.delete(operation.id);
      throw new InvalidGraphError(`Cycle detected when adding dependency for operation ${operation.id}.`);
    }
  }

  /**
   * Standard DFS Cycle Detection (Tarjan simplified)
   */
  private detectCycle(startNodeId: string): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) return true; // Found a cycle!
      if (visited.has(nodeId)) return false; // Already checked

      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.waitingQueue.get(nodeId);
      if (node && node.dependencies) {
        for (const dep of node.dependencies) {
          if (dfs(dep)) return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    return dfs(startNodeId);
  }

  public resolveDependency(resolvedOperationId: string): void {
    // Find all waiting operations that depend on this operation ID
    for (const [id, op] of this.waitingQueue.entries()) {
      if (op.dependencies?.includes(resolvedOperationId)) {
        // Remove the resolved dependency
        op.dependencies = op.dependencies.filter(dep => dep !== resolvedOperationId);
        
        // If all dependencies are resolved, move to sync queue
        if (op.dependencies.length === 0) {
          SyncQueueService.enqueue(op);
          this.waitingQueue.delete(id);
        }
      }
    }
  }

  public getWaitingCount(): number {
    return this.waitingQueue.size;
  }
}

export const DependencyQueueService = DependencyQueueServiceImpl.getInstance();

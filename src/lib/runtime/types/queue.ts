export type QueueOperationType = 'CREATE' | 'UPDATE' | 'DELETE' | 'RPC';
export type QueueOperationStatus = 'pending' | 'syncing' | 'failed' | 'completed' | 'dead_letter';
export type QueuePriority = 'high' | 'normal' | 'low' | 'background';

export interface QueueMetadata {
  tenant_id: string;
  user_id: string;
  session_id?: string;
  device_id?: string;
  runtime_version: string;
  queue_version: string;
  correlation_id?: string;
  trace_id?: string;
}

export interface SerializableIntent {
  action: QueueOperationType;
  entity: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface QueueOperation {
  id: string;
  type: QueueOperationType;
  entity: string; // e.g., 'contacts', 'leads'
  payload: any;
  priority: QueuePriority;
  status: QueueOperationStatus;
  
  // Immutables
  createdAt: Date;
  updatedAt: Date;
  metadata: QueueMetadata;
  
  // Mutables tracked by runtime
  retryCount: number;
  dependencies?: string[]; // IDs of other operations that must succeed first
  error?: string;
}

export interface OperationResult {
  success: boolean;
  operationId: string;
  error?: string;
  isPermanentFailure?: boolean;
}

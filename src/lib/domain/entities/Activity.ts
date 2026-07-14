export type ActivityType = 'Task' | 'Call' | 'Meeting' | 'Note';

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  
  // Universal Polymorphic Linkage
  relatedEntityId: string;
  relatedEntityType: string; // e.g. 'Lead', 'Account', 'Opportunity', 'Order', 'Expense'
  
  ownerId: string;
  assignedToId?: string;
  
  status: string; // Dynamic via Policy
  dueDate?: string;
  completedAt?: string;
  
  isArchived: boolean;
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

export interface Account {
  id: string;
  name: string;
  code?: string;
  type: string; // From AccountTypePolicy
  industry?: string;
  ownerId?: string;
  status: string;
  parentId?: string; // For hierarchy
  
  // Infrastructure metadata
  isArchived: boolean;
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string; // Dynamic based on policy
  assigneeId?: string;
  isArchived: boolean;
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

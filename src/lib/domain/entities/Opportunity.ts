export interface Opportunity {
  id: string;
  name: string;
  code?: string;
  leadId?: string;
  accountId: string;
  ownerId?: string;
  
  pipelineId: string;
  stageId: string;
  
  probability: number;
  forecastAmount: number;
  expectedCloseDate?: string;
  currency: string;
  priority: string;
  
  isArchived: boolean;
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

export interface PriceBook {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  
  // Future proofing for hierarchical inheritance
  parentPriceBookId?: string;
  
  // Temporal bounds for the entire catalog
  validFrom?: string;
  validTo?: string;
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

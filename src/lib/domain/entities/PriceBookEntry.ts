export interface PriceBookEntry {
  id: string;
  priceBookId: string;
  
  // References CommercialProduct (or Product depending on deployment choice, but we link to CommercialProduct for ultimate decoupling)
  commercialProductId: string;
  
  listPrice: number;
  
  // Temporal lifecycle of this specific price point
  effectiveFrom: string;
  effectiveTo?: string;
  
  isActive: boolean;
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

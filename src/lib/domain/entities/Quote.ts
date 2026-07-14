export interface Quote {
  id: string;
  opportunityId: string;
  accountId: string;
  
  status: string; // Controlled by QuoteStatusPolicy
  validUntil: string;
  currency: string;
  
  // Financials calculated by PricingService & TaxService
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  
  // Versioning
  versionNumber: number;
  isHistorical: boolean; // If true, quote is immutable and read-only
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

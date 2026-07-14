export type OrderCommercialStatus = 'Draft' | 'Confirmed' | 'Cancelled' | 'Closed';
export type OrderFulfillmentStatus = 'Pending' | 'Provisioning' | 'Activated' | 'Fulfilled';

export interface Order {
  id: string;
  
  // Traceability
  accountId: string;
  opportunityId: string;
  quoteId: string;
  quoteVersionNumber: number;
  convertedFromQuoteAt: string;
  convertedByUserId: string;
  idempotencyKey: string;
  
  // Metadata
  orderNumber: string;
  orderedAt: string;
  confirmedAt?: string;
  
  // Financial Snapshots (Immutable)
  currency: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  
  // Lifecycle
  commercialStatus: OrderCommercialStatus;
  fulfillmentStatus: OrderFulfillmentStatus;
  
  // Sync
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

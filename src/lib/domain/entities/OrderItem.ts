export interface OrderItem {
  id: string;
  orderId: string;
  
  // Snapshot Isolation
  catalogProductId?: string;
  commercialProductId?: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  descriptionSnapshot: string;
  
  // Financial Snapshots (Immutable)
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  taxAmount: number;
  lineTotal: number;
}

export interface QuoteLineItem {
  id: string;
  quoteId: string;
  
  // Prepare for CRM-007 (Products Module)
  productId?: string;
  
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  
  // Financials calculated by PricingService
  totalDiscount: number;
  commercialTotal: number;
}

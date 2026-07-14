export interface PricingLineItemInput {
  quantity: number;
  unitPrice: number;
  discountPercent: number; // e.g. 10 for 10%
}

export interface PricingResult {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  lineItems: Array<{
    totalDiscount: number;
    commercialTotal: number;
  }>;
}

export class PricingService {
  /**
   * Calculates the pure commercial values (Subtotals, Discounts) completely independent of taxation.
   */
  public calculate(items: PricingLineItemInput[]): PricingResult {
    let subtotal = 0;
    let discountTotal = 0;
    const processedLines = [];

    for (const item of items) {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = lineSubtotal * (item.discountPercent / 100);
      const commercialTotal = lineSubtotal - lineDiscount;

      subtotal += lineSubtotal;
      discountTotal += lineDiscount;
      
      processedLines.push({
        totalDiscount: lineDiscount,
        commercialTotal: commercialTotal
      });
    }

    return {
      subtotal,
      discountTotal,
      taxableAmount: subtotal - discountTotal,
      lineItems: processedLines
    };
  }
}

import { PricingResult } from '../pricing/PricingService';

export interface TaxConfiguration {
  defaultTaxRate: number; // e.g. 10 for 10%
  jurisdiction: string;
}

export interface TaxResult {
  taxTotal: number;
  grandTotal: number;
}

export class TaxService {
  /**
   * Consumes a PricingResult and applies jurisdiction-specific tax rules.
   */
  public calculateTax(commercialResult: PricingResult, config: TaxConfiguration): TaxResult {
    // In a real system, this would evaluate complex rules based on jurisdiction, product type, etc.
    // For this migration, we apply a flat rate for simplicity.
    const taxTotal = commercialResult.taxableAmount * (config.defaultTaxRate / 100);
    const grandTotal = commercialResult.taxableAmount + taxTotal;

    return {
      taxTotal,
      grandTotal
    };
  }
}

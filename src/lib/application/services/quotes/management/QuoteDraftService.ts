import { PricingService, PricingLineItemInput } from '../../pricing/PricingService';
import { TaxService, TaxConfiguration } from '../../taxation/TaxService';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';

export class QuoteDraftService {
  constructor(
    private readonly pricingService: PricingService,
    private readonly taxService: TaxService
  ) {}

  /**
   * Previews totals without persisting. Shields UI from math orchestration.
   */
  public async previewQuote(lineItems: PricingLineItemInput[], taxConfig: TaxConfiguration): Promise<ApplicationResult<any>> {
    try {
      // 1. Calculate pure commercial value
      const pricingResult = this.pricingService.calculate(lineItems);

      // 2. Calculate jurisdiction taxes
      const taxResult = this.taxService.calculateTax(pricingResult, taxConfig);

      // 3. Return aggregated preview
      return ApplicationResult.success({
        subtotal: pricingResult.subtotal,
        discountTotal: pricingResult.discountTotal,
        taxTotal: taxResult.taxTotal,
        grandTotal: taxResult.grandTotal,
        lineItems: pricingResult.lineItems
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('PREVIEW_ERROR', e.message));
    }
  }
}

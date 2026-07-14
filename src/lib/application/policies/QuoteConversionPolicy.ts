import { Quote } from '../../domain/entities/Quote';
import { ApplicationError } from '../core/ApplicationResult';

export class QuoteConversionPolicy {
  public validate(quote: Quote): void {
    if (quote.status !== 'Accepted') {
      throw new ApplicationError('VALIDATION_ERROR', `Cannot convert quote in status ${quote.status}. Only Accepted quotes can be converted.`);
    }
    
    // In a full implementation, this might also check if quote.convertedOrderId exists (if we add reverse linking to Quote entity as requested)
    if ((quote as any).convertedOrderId) {
      throw new ApplicationError('VALIDATION_ERROR', 'This quote has already been converted to an order.');
    }
  }
}

import { Quote } from '../../../domain/entities/Quote';
import { QuoteLineItem } from '../../../domain/entities/QuoteLineItem';

export class QuoteRepository {
  async create(quote: Partial<Quote>, lineItems: Partial<QuoteLineItem>[]): Promise<void> {}
  
  async update(id: string, data: Partial<Quote>): Promise<void> {}
  
  async findById(id: string): Promise<Quote | null> {
    return null;
  }
  
  async getLineItems(quoteId: string): Promise<QuoteLineItem[]> {
    return [];
  }
}

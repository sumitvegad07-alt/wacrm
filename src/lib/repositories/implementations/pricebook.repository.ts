import { PriceBook } from '../../domain/entities/PriceBook';
import { PriceBookEntry } from '../../domain/entities/PriceBookEntry';

export class PriceBookRepository {
  async createBook(data: Partial<PriceBook>): Promise<void> {}
  
  async createEntry(data: Partial<PriceBookEntry>): Promise<void> {}
  
  async getEntriesForProduct(priceBookId: string, commercialProductId: string): Promise<PriceBookEntry[]> { return []; }
}

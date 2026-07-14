import { Product } from '../../../domain/entities/Product';

export class ProductRepository {
  async create(data: Partial<Product>): Promise<void> {}
  
  async update(id: string, data: Partial<Product>): Promise<void> {}
  
  async findById(id: string): Promise<Product | null> { return null; }
  
  async skuExists(sku: string): Promise<boolean> { return false; }
  
  // Stubs for the RetireProductCommandHandler rule check
  async getActiveQuoteReferences(productId: string): Promise<number> { return 0; }
}

import { Order } from '../../../domain/entities/Order';
import { OrderItem } from '../../../domain/entities/OrderItem';

export class OrderRepository {
  /**
   * STRICT RULE: Repositories may only Persist, Query, or Delete.
   * They may NEVER convert quotes, publish events, or validate policies.
   */
  async create(order: Partial<Order>, items: Partial<OrderItem>[]): Promise<void> {}
  
  async updateCommercialStatus(id: string, status: string): Promise<void> {}
  
  async updateFulfillmentStatus(id: string, status: string): Promise<void> {}
  
  async findById(id: string): Promise<Order | null> { return null; }
  
  // Useful for idempotency check
  async findByIdempotencyKey(key: string): Promise<Order | null> { return null; }
}

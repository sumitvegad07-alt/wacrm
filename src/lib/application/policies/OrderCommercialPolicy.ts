import { OrderCommercialStatus } from '../../../domain/entities/Order';

export class OrderCommercialPolicy {
  public canTransition(current: OrderCommercialStatus, next: OrderCommercialStatus): boolean {
    const validTransitions: Record<OrderCommercialStatus, OrderCommercialStatus[]> = {
      'Draft': ['Confirmed', 'Cancelled'],
      'Confirmed': ['Closed', 'Cancelled'],
      'Cancelled': [],
      'Closed': []
    };
    return validTransitions[current]?.includes(next) ?? false;
  }
}

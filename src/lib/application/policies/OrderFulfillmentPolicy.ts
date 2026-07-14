import { OrderFulfillmentStatus } from '../../domain/entities/Order';

export class OrderFulfillmentPolicy {
  public canTransition(current: OrderFulfillmentStatus, next: OrderFulfillmentStatus): boolean {
    const validTransitions: Record<OrderFulfillmentStatus, OrderFulfillmentStatus[]> = {
      'Pending': ['Provisioning', 'Fulfilled', 'Activated'],
      'Provisioning': ['Activated', 'Fulfilled'],
      'Activated': ['Fulfilled'],
      'Fulfilled': []
    };
    return validTransitions[current]?.includes(next) ?? false;
  }
}

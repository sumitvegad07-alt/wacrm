import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { QuoteConversionPolicy } from '../../../policies/QuoteConversionPolicy';
import { OrderNumberService } from './OrderNumberService';
import { OrderRepository } from '../../../../repositories/implementations/order.repository';
import { QuoteRepository } from '../../../../repositories/implementations/quote.repository';
import { v4 as uuidv4 } from 'uuid';

export class QuoteConversionService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly quoteRepository: QuoteRepository,
    private readonly orderNumberService: OrderNumberService,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async convert(quoteId: string, userId: string, idempotencyKey: string): Promise<ApplicationResult<string>> {
    try {
      // 1. Idempotency Check
      const existingOrder = await this.orderRepository.findByIdempotencyKey(idempotencyKey);
      if (existingOrder) return ApplicationResult.success(existingOrder.id);

      // 2. Load Quote
      const quote = await this.quoteRepository.findById(quoteId);
      if (!quote) throw new ApplicationError('NOT_FOUND', 'Quote not found.');

      // 3. Business Policy Validation
      const policy = new QuoteConversionPolicy();
      policy.validate(quote);

      return await this.unitOfWork.execute(async () => {
        // 4. Generate Order Number
        const orderNumber = await this.orderNumberService.generateNextOrderNumber();
        const orderId = uuidv4();

        // 5. Create Exact Snapshot (NO PRICING RECALCULATION)
        const order = {
          id: orderId,
          accountId: quote.accountId,
          opportunityId: quote.opportunityId,
          quoteId: quote.id,
          quoteVersionNumber: quote.versionNumber,
          convertedFromQuoteAt: new Date().toISOString(),
          convertedByUserId: userId,
          idempotencyKey: idempotencyKey,
          orderNumber,
          orderedAt: new Date().toISOString(),
          currency: quote.currency,
          exchangeRate: 1.0, // Should be snapshotted from quote in a real impl
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          taxTotal: quote.taxTotal,
          grandTotal: quote.grandTotal,
          commercialStatus: 'Confirmed' as const,
          fulfillmentStatus: 'Pending' as const,
          sync_status: 'pending' as const,
          sync_version: 1
        };

        // 6. Snapshot Line Items
        const quoteItems = await this.quoteRepository.getLineItems(quote.id);
        const orderItems = quoteItems.map(qi => ({
          id: uuidv4(),
          orderId: order.id,
          catalogProductId: qi.productId,
          skuSnapshot: 'SKU-SNAP', // Mocked lookup
          productNameSnapshot: 'Product Name', // Mocked lookup
          descriptionSnapshot: qi.description,
          quantity: qi.quantity,
          unitPrice: qi.unitPrice,
          discountPercent: qi.discountPercent,
          taxPercent: qi.taxPercent || 0,
          taxAmount: (qi.commercialTotal * (qi.taxPercent || 0)) / 100,
          lineTotal: qi.commercialTotal
        }));

        // 7. Persist Order
        await this.orderRepository.create(order, orderItems);

        // 8. Reverse Link Quote
        await this.quoteRepository.update(quote.id, { status: 'Converted', convertedOrderId: order.id } as any);

        // 9. Emit Lifecycle Event
        await this.domainEventBus.publish({
          eventName: 'OrderCreated',
          payload: { orderId: order.id, quoteId: quote.id },
          timestamp: Date.now()
        });

        return ApplicationResult.success(order.id);
      });
    } catch (e: any) {
      // 10. Emit Failure Event for Telemetry
      await this.domainEventBus.publish({
        eventName: 'OrderConversionFailed',
        payload: { quoteId, reason: e.message },
        timestamp: Date.now()
      });
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

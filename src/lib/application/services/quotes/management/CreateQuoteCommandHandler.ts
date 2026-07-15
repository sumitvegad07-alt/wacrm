import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { QuoteDraftService } from './QuoteDraftService';
import { QuoteRepository } from '../../../../repositories/implementations/quote.repository';
import { v4 as uuidv4 } from 'uuid';

export class CreateQuoteCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly opportunityId: string,
    public readonly accountId: string,
    public readonly rawLineItems: any[],
    public readonly taxConfig: any
  ) {}
}

export class CreateQuoteCommandHandler implements ICommandHandler<CreateQuoteCommand, string> {
  constructor(
    private readonly repository: QuoteRepository,
    private readonly draftService: QuoteDraftService,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateQuoteCommand): Promise<ApplicationResult<string>> {
    try {
      // 1. Ask the Draft Service to safely orchestrate pricing + tax math
      const previewResult = await this.draftService.previewQuote(command.rawLineItems, command.taxConfig);
      if (!previewResult.isSuccess) throw previewResult.getErrorOrThrow();
      
      const financials = previewResult.value;

      return await this.unitOfWork.execute(async () => {
        const quote = {
          id: command.id,
          opportunityId: command.opportunityId,
          accountId: command.accountId,
          status: 'Draft',
          currency: 'USD',
          subtotal: financials.subtotal,
          taxTotal: financials.taxTotal,
          discountTotal: financials.discountTotal,
          grandTotal: financials.grandTotal,
          versionNumber: 1,
          isHistorical: false,
          sync_status: 'pending' as const,
          sync_version: 1
        };

        const processedLines = command.rawLineItems.map((li, idx) => ({
          id: uuidv4(),
          quoteId: quote.id,
          productId: li.productId, // Optional for CRM-007
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discountPercent: li.discountPercent,
          totalDiscount: financials.lineItems[idx].totalDiscount,
          commercialTotal: financials.lineItems[idx].commercialTotal
        }));

        // 2. Persist
        await this.repository.create(quote, processedLines);

        // 3. Emit Domain Event
        await this.domainEventBus.publish({
          eventName: 'QuoteGenerated',
          payload: quote,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

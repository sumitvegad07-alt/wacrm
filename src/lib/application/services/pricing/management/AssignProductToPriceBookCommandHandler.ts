import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { PriceBookRepository } from '../../../../repositories/implementations/pricebook.repository';
import { PriceBookPolicy } from '../../../policies/PriceBookPolicy';

export class AssignProductToPriceBookCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly priceBookId: string,
    public readonly commercialProductId: string,
    public readonly listPrice: number,
    public readonly effectiveFrom: string,
    public readonly effectiveTo?: string
  ) {}
}

export class AssignProductToPriceBookCommandHandler implements ICommandHandler<AssignProductToPriceBookCommand, string> {
  constructor(
    private readonly repository: PriceBookRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: AssignProductToPriceBookCommand): Promise<ApplicationResult<string>> {
    try {
      const existingEntries = await this.repository.getEntriesForProduct(command.priceBookId, command.commercialProductId);
      
      const newEntry = {
        id: command.id,
        priceBookId: command.priceBookId,
        commercialProductId: command.commercialProductId,
        listPrice: command.listPrice,
        effectiveFrom: command.effectiveFrom,
        effectiveTo: command.effectiveTo,
        isActive: true,
        sync_status: 'pending' as const,
        sync_version: 1
      };

      const policy = new PriceBookPolicy();
      policy.validateNoTemporalOverlap(newEntry, existingEntries); // Will throw ApplicationError if overlap exists

      return await this.unitOfWork.execute(async () => {
        await this.repository.createEntry(newEntry);

        await this.domainEventBus.publish({
          eventName: 'PriceBookEntryCreated',
          payload: newEntry,
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

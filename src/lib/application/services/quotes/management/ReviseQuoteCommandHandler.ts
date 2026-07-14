import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { QuoteRepository } from '../../../../repositories/implementations/quote.repository';
import { QuoteVersion } from '../../../../domain/value-objects/QuoteVersion';
import { CreateQuoteCommand, CreateQuoteCommandHandler } from './CreateQuoteCommandHandler';

export class ReviseQuoteCommand implements ICommand {
  constructor(
    public readonly existingQuoteId: string,
    public readonly newQuoteId: string,
    public readonly updatedLineItems: any[],
    public readonly taxConfig: any
  ) {}
}

export class ReviseQuoteCommandHandler implements ICommandHandler<ReviseQuoteCommand, string> {
  constructor(
    private readonly repository: QuoteRepository,
    private readonly createQuoteHandler: CreateQuoteCommandHandler,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: ReviseQuoteCommand): Promise<ApplicationResult<string>> {
    try {
      return await this.unitOfWork.execute(async () => {
        const oldQuote = await this.repository.findById(command.existingQuoteId);
        if (!oldQuote) throw new ApplicationError('NOT_FOUND', 'Quote not found');
        if (oldQuote.isHistorical) throw new ApplicationError('VALIDATION_ERROR', 'Cannot revise a historical quote snapshot');

        // 1. Lock existing quote as historical (Immutable)
        await this.repository.update(oldQuote.id, { isHistorical: true, status: 'Superseded' });

        const nextVersion = new QuoteVersion(oldQuote.versionNumber).getNextVersion();

        // 2. Delegate to CreateQuoteHandler to calculate math and persist new version
        const result = await this.createQuoteHandler.execute(new CreateQuoteCommand(
          command.newQuoteId,
          oldQuote.opportunityId,
          oldQuote.accountId,
          command.updatedLineItems,
          command.taxConfig
        ));

        if (!result.isSuccess) throw result.getErrorOrThrow();

        // 3. Override version number on the newly created quote
        await this.repository.update(command.newQuoteId, { versionNumber: nextVersion.versionNumber });

        await this.domainEventBus.publish({
          eventName: 'QuoteRevised',
          payload: { oldQuoteId: oldQuote.id, newQuoteId: command.newQuoteId, version: nextVersion.versionNumber },
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.newQuoteId);
      });
    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

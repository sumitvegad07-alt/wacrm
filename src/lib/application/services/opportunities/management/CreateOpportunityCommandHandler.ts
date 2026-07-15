import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { OpportunityRepository } from '../../../../repositories/implementations/opportunity.repository';

export class CreateOpportunityCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly accountId: string,
    public readonly pipelineId: string,
    public readonly stageId: string,
    public readonly probability: number,
    public readonly forecastAmount: number,
    public readonly leadId?: string
  ) {}
}

export class CreateOpportunityCommandHandler implements ICommandHandler<CreateOpportunityCommand, string> {
  constructor(
    private readonly repository: OpportunityRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateOpportunityCommand): Promise<ApplicationResult<string>> {
    try {
      if (!command.accountId) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Opportunity must be linked to an Account.'));
      }

      return await this.unitOfWork.execute(async () => {
        const oppData = {
          id: command.id,
          name: command.name,
          accountId: command.accountId,
          leadId: command.leadId,
          pipelineId: command.pipelineId,
          stageId: command.stageId,
          probability: command.probability,
          forecastAmount: command.forecastAmount,
          currency: 'USD',
          priority: 'Medium',
          isArchived: false,
          sync_status: 'pending' as const,
          sync_version: 1,
        };

        await this.repository.create(oppData);

        await this.domainEventBus.publish({
          eventName: 'OpportunityCreated',
          payload: oppData,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

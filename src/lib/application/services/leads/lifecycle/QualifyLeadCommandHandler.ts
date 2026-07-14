import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { LeadRepository } from '../../../../repositories/implementations/lead.repository';
import { LeadStatusPolicy, defaultLeadStatusConfig } from '../../../policies/LeadStatusConfiguration';

export class QualifyLeadCommand implements ICommand {
  constructor(public readonly leadId: string, public readonly newStatus: string) {}
}

export class QualifyLeadCommandHandler implements ICommandHandler<QualifyLeadCommand, void> {
  constructor(
    private readonly repository: LeadRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: QualifyLeadCommand): Promise<ApplicationResult<void>> {
    try {
      const statusPolicy = new LeadStatusPolicy(defaultLeadStatusConfig);
      
      // We would normally fetch the lead here to check currentStatus
      const currentStatus = defaultLeadStatusConfig.defaultStatus;

      if (!statusPolicy.isValidTransition(currentStatus, command.newStatus)) {
        return ApplicationResult.failure(
          new ApplicationError('VALIDATION_ERROR', 'Invalid lead status transition to ' + command.newStatus)
        );
      }

      return await this.unitOfWork.execute(async () => {
        await this.repository.update(command.leadId, { status: command.newStatus });

        // Core Requirement: Publish Lifecycle Domain Event
        await this.domainEventBus.publish({
          eventName: 'LeadQualified',
          payload: { leadId: command.leadId, newStatus: command.newStatus },
          timestamp: Date.now()
        });

        return ApplicationResult.success();
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

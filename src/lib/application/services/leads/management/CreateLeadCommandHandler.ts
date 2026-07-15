import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { LeadRepository } from '../../../../repositories/implementations/lead.repository';
import { LeadStatusPolicy, defaultLeadStatusConfig } from '../../../policies/LeadStatusConfiguration';

export class CreateLeadCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly email?: string,
    public readonly phone?: string
  ) {}
}

export class CreateLeadCommandHandler implements ICommandHandler<CreateLeadCommand, string> {
  constructor(
    private readonly repository: LeadRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateLeadCommand): Promise<ApplicationResult<string>> {
    try {
      if (!command.name || command.name.trim() === '') {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Lead name is required.'));
      }

      const statusPolicy = new LeadStatusPolicy(defaultLeadStatusConfig);

      return await this.unitOfWork.execute(async () => {
        const leadData = {
          id: command.id,
          name: command.name,
          email: command.email,
          phone: command.phone,
          status: statusPolicy.getDefaultStatus(),
          isArchived: false,
          sync_status: 'pending' as const,
          sync_version: 1,
        };

        await this.repository.create(leadData);

        // Core Requirement: Publish Domain Event
        await this.domainEventBus.publish({
          eventName: 'LeadCreated',
          payload: leadData,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

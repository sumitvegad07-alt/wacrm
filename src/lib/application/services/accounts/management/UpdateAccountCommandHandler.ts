import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { AccountRepository } from '../../../../repositories/implementations/account.repository';
import { AccountHierarchyService } from '../hierarchy/AccountHierarchyService';

export class UpdateAccountCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly updates: {
      name?: string;
      code?: string;
      industry?: string;
      parentId?: string;
    }
  ) {}
}

export class UpdateAccountCommandHandler implements ICommandHandler<UpdateAccountCommand, void> {
  constructor(
    private readonly repository: AccountRepository,
    private readonly hierarchyService: AccountHierarchyService,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: UpdateAccountCommand): Promise<ApplicationResult<void>> {
    try {
      return await this.unitOfWork.execute(async () => {
        // Validate Hierarchy if parentId is being updated
        if (command.updates.parentId !== undefined) {
          await this.hierarchyService.validateNoCycles(command.id, command.updates.parentId);
        }

        await this.repository.update(command.id, command.updates);

        await this.domainEventBus.publish({
          eventName: 'AccountUpdated',
          payload: { id: command.id, updates: command.updates },
          timestamp: Date.now()
        });

        return ApplicationResult.success();
      });
    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

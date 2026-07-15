import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../core/ApplicationResult';
import { IUnitOfWork } from '../../core/IUnitOfWork';
import { DomainEventBus } from '../../core/DomainEventBus';
import { ActivityRepository } from '../../../repositories/implementations/activity.repository';
import { ActivityType } from '../../../domain/entities/Activity';

export class CreateActivityCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly type: ActivityType,
    public readonly title: string,
    public readonly relatedEntityId: string,
    public readonly relatedEntityType: string,
    public readonly dueDate?: string
  ) {}
}

export class CreateActivityCommandHandler implements ICommandHandler<CreateActivityCommand, string> {
  constructor(
    private readonly repository: ActivityRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateActivityCommand): Promise<ApplicationResult<string>> {
    try {
      if (!command.relatedEntityId || !command.relatedEntityType) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Activity must be linked to a related entity.'));
      }

      return await this.unitOfWork.execute(async () => {
        const activityData = {
          id: command.id,
          type: command.type,
          title: command.title,
          relatedEntityId: command.relatedEntityId,
          relatedEntityType: command.relatedEntityType, // Universal polymorphic link
          dueDate: command.dueDate,
          ownerId: '', // Required field – populated by infrastructure/auth context in production
          status: 'Open',
          isArchived: false,
          sync_status: 'pending' as const,
          sync_version: 1,
        };

        await this.repository.create(activityData);

        await this.domainEventBus.publish({
          eventName: 'ActivityCreated',
          payload: activityData,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

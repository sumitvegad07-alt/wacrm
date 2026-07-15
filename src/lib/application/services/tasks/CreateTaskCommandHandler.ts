import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../core/ApplicationResult';
import { IUnitOfWork } from '../../core/IUnitOfWork';
import { DomainEventBus } from '../../core/DomainEventBus';
// Using any for missing TaskRepository in this infrastructure sprint
// import { TaskRepository } from '../../../repositories/implementations/task.repository';

export class CreateTaskCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly dueDate: number,
    public readonly contactId?: string
  ) {}
}

export class CreateTaskCommandHandler implements ICommandHandler<CreateTaskCommand, string> {
  constructor(
    private readonly taskRepository: any, // Injected via DI
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateTaskCommand): Promise<ApplicationResult<string>> {
    try {
      // 1. Business Validation
      if (!command.title || command.title.trim().length === 0) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Task title is required'));
      }
      
      if (command.dueDate < Date.now()) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Task due date must be in the future'));
      }

      // 2. Transaction Boundaries
      return await this.unitOfWork.execute(async () => {
        
        const taskData = {
          id: command.id,
          title: command.title,
          dueDate: command.dueDate,
          contactId: command.contactId,
          status: 'pending',
          sync_status: 'pending' as const,
          sync_version: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
          deleted_at: null
        };

        if (this.taskRepository && this.taskRepository.create) {
          await this.taskRepository.create(taskData);
        }

        // 4. Domain Event Publishing
        await this.domainEventBus.publish({
          eventName: 'TaskCreated',
          payload: taskData,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (error: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', error.message));
    }
  }
}

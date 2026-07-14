import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../core/ApplicationResult';
import { IUnitOfWork } from '../../core/IUnitOfWork';
import { DomainEventBus } from '../../core/DomainEventBus';
import { ContactRepository } from '../../../repositories/implementations/contact.repository';

export class MergeContactsCommand implements ICommand {
  constructor(
    public readonly sourceContactId: string,
    public readonly destinationContactId: string
  ) {}
}

export class MergeContactsCommandHandler implements ICommandHandler<MergeContactsCommand, void> {
  constructor(
    private readonly contactRepository: ContactRepository,
    // private readonly taskRepository: TaskRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: MergeContactsCommand): Promise<ApplicationResult<void>> {
    try {
      // 1. Business Validation
      if (command.sourceContactId === command.destinationContactId) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Cannot merge a contact into itself'));
      }

      // 2. Cross-Repository Transaction
      return await this.unitOfWork.execute(async () => {
        
        // Example logic:
        // const source = await this.contactRepository.findById(command.sourceContactId);
        // if (!source) throw new Error("Source contact not found");
        
        // await this.taskRepository.reassignContact(command.sourceContactId, command.destinationContactId);
        
        // Soft delete the source contact
        await this.contactRepository.delete(command.sourceContactId);

        // 4. Domain Event Publishing
        await this.domainEventBus.publish({
          eventName: 'ContactsMerged',
          payload: { sourceId: command.sourceContactId, destId: command.destinationContactId },
          timestamp: Date.now()
        });
        
        // Bridge will catch ContactDeleted and sync the soft-delete to Supabase

        return ApplicationResult.success();
      });
    } catch (error: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', error.message));
    }
  }
}

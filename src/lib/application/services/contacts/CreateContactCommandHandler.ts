import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../core/ApplicationResult';
import { IUnitOfWork } from '../../core/IUnitOfWork';
import { DomainEventBus } from '../../core/DomainEventBus';
import { ContactRepository } from '../../../repositories/implementations/contact.repository';
// Note: Normally we'd depend on an IContactRepository interface for pure abstraction
// but using the concrete implementation for this infrastructure sprint.

export class CreateContactCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly phone?: string,
    public readonly email?: string
  ) {}
}

export class CreateContactCommandHandler implements ICommandHandler<CreateContactCommand, string> {
  constructor(
    private readonly contactRepository: ContactRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateContactCommand): Promise<ApplicationResult<string>> {
    try {
      // 1. Business Validation
      if (!command.name || command.name.trim().length === 0) {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Contact name is required'));
      }

      // 2. Transaction Boundaries
      return await this.unitOfWork.execute(async () => {
        
        // 3. Repository Execution (Storage)
        // contactRepository expects Omit<Contact, 'id'> from the repositories/interfaces which is:
        // { name: string, phone: string, email?: string }
        const contactData = {
          name: command.name,
          phone: command.phone || '', // phone is required by repo interface
          email: command.email
        };

        const result = await this.contactRepository.create(contactData);
        if (!result.success || !result.data) {
          throw new Error('Failed to create contact in repository');
        }

        // 4. Domain Event Publishing
        await this.domainEventBus.publish({
          eventName: 'ContactCreated',
          payload: result.data,
          timestamp: Date.now()
        });

        return ApplicationResult.success(result.data.id);
      });
    } catch (error: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', error.message));
    }
  }
}

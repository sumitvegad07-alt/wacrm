import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { AccountRepository } from '../../../../repositories/implementations/account.repository';
import { AccountTypePolicy, defaultAccountTypeConfig } from '../../../policies/AccountTypeConfiguration';

export class CreateAccountCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly name: string
  ) {}
}

export class CreateAccountCommandHandler implements ICommandHandler<CreateAccountCommand, string> {
  constructor(
    private readonly repository: AccountRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateAccountCommand): Promise<ApplicationResult<string>> {
    try {
      if (!command.name || command.name.trim() === '') {
        return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Account name is required.'));
      }

      const typePolicy = new AccountTypePolicy(defaultAccountTypeConfig);

      return await this.unitOfWork.execute(async () => {
        const accountData = {
          id: command.id,
          name: command.name,
          type: typePolicy.getDefaultType(),
          status: 'Active',
          isArchived: false,
          sync_status: 'pending' as const,
          sync_version: 1,
        };

        await this.repository.create(accountData);

        // Core Requirement: Publish Domain Event
        await this.domainEventBus.publish({
          eventName: 'AccountCreated',
          payload: accountData,
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

import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { AccountRepository } from '../../../../repositories/implementations/account.repository';
import { AccountTypePolicy, defaultAccountTypeConfig } from '../../../policies/AccountTypeConfiguration';

export class UpdateAccountStatusCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly newType: string
  ) {}
}

export class UpdateAccountStatusCommandHandler implements ICommandHandler<UpdateAccountStatusCommand, void> {
  constructor(
    private readonly repository: AccountRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: UpdateAccountStatusCommand): Promise<ApplicationResult<void>> {
    try {
      const typePolicy = new AccountTypePolicy(defaultAccountTypeConfig);
      
      if (!typePolicy.isValidType(command.newType)) {
        return ApplicationResult.failure(
          new ApplicationError('VALIDATION_ERROR', \`Invalid account classification type: \${command.newType}\`)
        );
      }

      return await this.unitOfWork.execute(async () => {
        await this.repository.update(command.id, { type: command.newType });

        await this.domainEventBus.publish({
          eventName: 'AccountTypeChanged',
          payload: { id: command.id, newType: command.newType },
          timestamp: Date.now()
        });

        return ApplicationResult.success();
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { CommunicationPreferences } from '../../../../domain/entities/Contact';

export class UpdateContactPreferencesCommand implements ICommand {
  constructor(
    public readonly contactId: string,
    public readonly preferences: CommunicationPreferences
  ) {}
}

export class UpdateContactPreferencesCommandHandler implements ICommandHandler<UpdateContactPreferencesCommand, void> {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly domainEventBus: DomainEventBus
  ) {}

  public async execute(command: UpdateContactPreferencesCommand): Promise<ApplicationResult<void>> {
    try {
      return await this.unitOfWork.execute(async () => {
        // Stubbed repository update for Contact
        
        await this.domainEventBus.publish({
          eventName: 'ContactPreferencesUpdated',
          payload: { contactId: command.contactId, preferences: command.preferences },
          timestamp: Date.now()
        });

        return ApplicationResult.success();
      });
    } catch (e: any) {
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

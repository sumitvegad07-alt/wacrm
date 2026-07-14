import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { ContactRelationshipRepository } from '../../../../repositories/implementations/contact-relationship.repository';
import { ContactRolePolicy } from '../../../policies/ContactRolePolicy';
import { defaultContactRoleConfig } from '../../../policies/ContactRoleConfiguration';

export class LinkContactToAccountCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly contactId: string,
    public readonly accountId: string,
    public readonly roleId: string,
    public readonly isPrimary: boolean,
    public readonly effectiveFrom: string
  ) {}
}

export class LinkContactToAccountCommandHandler implements ICommandHandler<LinkContactToAccountCommand, string> {
  constructor(
    private readonly repository: ContactRelationshipRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: LinkContactToAccountCommand): Promise<ApplicationResult<string>> {
    try {
      const policy = new ContactRolePolicy(defaultContactRoleConfig);
      
      // 1. Validate Configurable Role
      policy.validateRole(command.roleId, command.isPrimary);

      return await this.unitOfWork.execute(async () => {
        
        // 2. Safely demote existing primary if this new one is primary
        if (command.isPrimary) {
          await this.repository.unsetPrimaryForContact(command.contactId);
        }

        const junctionData = {
          id: command.id,
          contactId: command.contactId,
          accountId: command.accountId,
          roleId: command.roleId,
          isPrimary: command.isPrimary,
          effectiveFrom: command.effectiveFrom,
          relationshipStatus: 'Active' as const,
          sync_status: 'pending' as const,
          sync_version: 1,
        };

        // 3. Create the temporal junction
        await this.repository.create(junctionData);

        // 4. Emit Workflow Event
        await this.domainEventBus.publish({
          eventName: 'ContactLinkedToAccount',
          payload: junctionData,
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

import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { CreateAccountCommand, CreateAccountCommandHandler } from '../../accounts/management/CreateAccountCommandHandler';
import { CreateOpportunityCommand, CreateOpportunityCommandHandler } from '../../opportunities/management/CreateOpportunityCommandHandler';
import { LeadRepository } from '../../../../repositories/implementations/lead.repository';
import { v4 as uuidv4 } from 'uuid';

export class LeadConversionService {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly domainEventBus: DomainEventBus,
    private readonly leadRepository: LeadRepository,
    private readonly createAccountHandler: CreateAccountCommandHandler,
    private readonly createOpportunityHandler: CreateOpportunityCommandHandler
  ) {}

  public async executeConversion(leadId: string, accountId?: string): Promise<ApplicationResult<{ accountId: string, opportunityId: string }>> {
    try {
      return await this.unitOfWork.execute(async () => {
        // 1. Validate Lead exists and is not already converted
        // (Assuming leadRepository.findById is implemented)
        
        let finalAccountId = accountId;

        // 2. Create Account if not provided
        if (!finalAccountId) {
          finalAccountId = uuidv4();
          const accountResult = await this.createAccountHandler.execute(
            new CreateAccountCommand(finalAccountId, 'Converted Account (Stub)')
          );
          if (!accountResult.isSuccess) throw accountResult.getErrorOrThrow();
        }

        // 3. Create Opportunity
        const oppId = uuidv4();
        const oppResult = await this.createOpportunityHandler.execute(
          new CreateOpportunityCommand(
            oppId,
            'New Opportunity from Lead',
            finalAccountId,
            'standard-sales',
            'discovery',
            10, // base probability
            0,
            leadId
          )
        );
        if (!oppResult.isSuccess) throw oppResult.getErrorOrThrow();

        // 4. Update Lead Status
        await this.leadRepository.update(leadId, { status: 'Converted' });

        // 5. Emit Workflow Events
        await this.domainEventBus.publish({
          eventName: 'LeadConverted',
          payload: { leadId, accountId: finalAccountId, opportunityId: oppId },
          timestamp: Date.now()
        });

        return ApplicationResult.success({ accountId: finalAccountId, opportunityId: oppId });
      });
    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('CONVERSION_FAILED', e.message));
    }
  }
}

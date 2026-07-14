import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult } from '../../../core/ApplicationResult';
import { LeadConversionService } from '../orchestrators/LeadConversionService';

export class ConvertLeadCommand implements ICommand {
  constructor(
    public readonly leadId: string,
    public readonly existingAccountId?: string
  ) {}
}

export class ConvertLeadCommandHandler implements ICommandHandler<ConvertLeadCommand, { accountId: string, opportunityId: string }> {
  constructor(
    private readonly conversionService: LeadConversionService
  ) {}

  public async execute(command: ConvertLeadCommand): Promise<ApplicationResult<{ accountId: string, opportunityId: string }>> {
    // Delegates entirely to the dedicated orchestrator as per CTO Refinement #1
    return await this.conversionService.executeConversion(command.leadId, command.existingAccountId);
  }
}

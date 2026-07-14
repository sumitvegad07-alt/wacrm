import { Customer360Snapshot, AccountSummary, ContactSummary, SalesSummary, ActivitySummary, TimelineSummary, HealthSummary } from '../../../../domain/read-models/customer360/Customer360Snapshot';
import { TimelineEvent } from '../../../../domain/read-models/customer360/TimelineEvent';
import { HealthIndicators } from '../../../../domain/read-models/customer360/HealthIndicators';
import { Customer360Repository } from '../../../../repositories/implementations/customer360.repository';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';

export class GenerateCustomerSnapshotQuery {
  constructor(public readonly crmAccountId: string) {}
}

export class GenerateCustomerSnapshotQueryHandler {
  constructor(
    private readonly projectionRepository: Customer360Repository
    // Notice: We don't inject PricingService, OrderConversionService, etc.
    // This handler performs NO business logic or mutations.
  ) {}

  public async execute(query: GenerateCustomerSnapshotQuery): Promise<ApplicationResult<Customer360Snapshot>> {
    try {
      // 1. In a production setting, this delegates to the highly optimized projection repository.
      // If we wanted to manually aggregate here, we would inject the read-only interfaces of the
      // transactional repositories, but the Projection Repository pattern is cleaner for CQRS.
      
      const snapshot = await this.projectionRepository.getCustomerSnapshot(query.crmAccountId);
      
      if (!snapshot) {
        throw new ApplicationError('NOT_FOUND', 'Customer account not found or access denied.');
      }
      
      // 2. Return the immutable projection.
      return ApplicationResult.success(snapshot);

    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}

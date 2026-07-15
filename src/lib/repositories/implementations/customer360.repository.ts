import { Customer360Snapshot } from '../../domain/read-models/customer360/Customer360Snapshot';

export class Customer360Repository {
  /**
   * STRICT RULE: This is a Projection Repository.
   * It returns only Customer360Snapshot projections.
   * It does not expose CRUD.
   * It does not replace existing transactional repositories.
   */
  async getCustomerSnapshot(crmAccountId: string): Promise<Customer360Snapshot | null> {
    // In a real implementation, this would efficiently query WatermelonDB/Supabase
    // leveraging local joins and indexes, then map into the Snapshot segments.
    return null;
  }
}

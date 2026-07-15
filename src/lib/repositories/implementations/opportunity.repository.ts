import { Opportunity } from '../../domain/entities/Opportunity';

export class OpportunityRepository {
  async create(data: Partial<Opportunity>): Promise<void> {}
  
  async update(id: string, data: Partial<Opportunity>): Promise<void> {}
  
  async archive(id: string): Promise<void> {}
  
  async restore(id: string): Promise<void> {}
}

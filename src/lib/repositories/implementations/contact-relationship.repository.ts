import { ContactAccountRelationship } from '../../../domain/entities/ContactAccountRelationship';

export class ContactRelationshipRepository {
  async create(data: Partial<ContactAccountRelationship>): Promise<void> {}
  
  async update(id: string, data: Partial<ContactAccountRelationship>): Promise<void> {}
  
  async findByContact(contactId: string): Promise<ContactAccountRelationship[]> {
    return [];
  }
  
  async findByAccount(accountId: string): Promise<ContactAccountRelationship[]> {
    return [];
  }

  // Atomically demotes previous primary relationship for this contact
  async unsetPrimaryForContact(contactId: string): Promise<void> {}
}

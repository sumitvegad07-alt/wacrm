import { Account } from '../../../domain/entities/Account';

export class AccountRepository {
  // In a real implementation this interacts with WatermelonDB (IStorageManager)
  
  async create(data: Partial<Account>): Promise<void> {}
  
  async update(id: string, data: Partial<Account>): Promise<void> {}
  
  async archive(id: string): Promise<void> {}
  
  async restore(id: string): Promise<void> {}
  
  async findById(id: string): Promise<Account | null> {
    // Stub for hierarchy validation
    return null;
  }
  
  async getChildren(parentId: string): Promise<Account[]> {
    // Stub for deep hierarchy traversal
    return [];
  }
}

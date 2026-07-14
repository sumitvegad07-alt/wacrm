import { AccountRepository } from '../../../../repositories/implementations/account.repository';
import { ApplicationError } from '../../../core/ApplicationResult';

export class AccountHierarchyService {
  constructor(private readonly accountRepository: AccountRepository) {}

  /**
   * Validates that assigning `newParentId` to `accountId` will not create a circular dependency.
   * Throws an ApplicationError if a cycle is detected.
   */
  public async validateNoCycles(accountId: string, newParentId: string): Promise<void> {
    if (accountId === newParentId) {
      throw new ApplicationError('VALIDATION_ERROR', 'An account cannot be its own parent.');
    }

    let currentParentId: string | undefined = newParentId;
    let depth = 0;
    const maxDepth = 50; // Guard against infinite loops in corrupted data

    while (currentParentId) {
      if (currentParentId === accountId) {
        throw new ApplicationError('VALIDATION_ERROR', 'Circular hierarchy detected. The proposed parent is already a descendant of this account.');
      }
      
      depth++;
      if (depth > maxDepth) {
        throw new ApplicationError('VALIDATION_ERROR', 'Hierarchy depth exceeded maximum allowed levels.');
      }

      const parentAccount = await this.accountRepository.findById(currentParentId);
      if (!parentAccount) {
        break; // Reached the top of the chain (or broken link)
      }
      
      currentParentId = parentAccount.parentId;
    }
  }
}

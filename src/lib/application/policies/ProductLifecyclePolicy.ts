import { ProductStatus } from '../../../domain/entities/Product';
import { ApplicationError } from '../core/ApplicationResult';

export class ProductLifecyclePolicy {
  public validateRetirement(productId: string, activeQuoteReferences: number): void {
    if (activeQuoteReferences > 0) {
      throw new ApplicationError('VALIDATION_ERROR', \`Product cannot be retired because it is referenced in \${activeQuoteReferences} active quotes.\`);
    }
  }
}

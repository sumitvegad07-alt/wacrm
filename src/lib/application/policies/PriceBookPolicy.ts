import { PriceBookEntry } from '../../domain/entities/PriceBookEntry';
import { ApplicationError } from '../core/ApplicationResult';

export class PriceBookPolicy {
  /**
   * Prevents assigning the same product to the same pricebook with overlapping dates.
   */
  public validateNoTemporalOverlap(newEntry: PriceBookEntry, existingEntries: PriceBookEntry[]): void {
    const newStart = new Date(newEntry.effectiveFrom).getTime();
    const newEnd = newEntry.effectiveTo ? new Date(newEntry.effectiveTo).getTime() : Number.MAX_SAFE_INTEGER;

    for (const existing of existingEntries) {
      if (!existing.isActive) continue;

      const existingStart = new Date(existing.effectiveFrom).getTime();
      const existingEnd = existing.effectiveTo ? new Date(existing.effectiveTo).getTime() : Number.MAX_SAFE_INTEGER;

      // Check for date range overlap
      if (newStart <= existingEnd && newEnd >= existingStart) {
        throw new ApplicationError('VALIDATION_ERROR', 'A price book entry for this product already exists in the specified date range.');
      }
    }
  }
}

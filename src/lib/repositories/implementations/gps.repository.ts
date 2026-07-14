import { BaseRepository } from '../base.repository';
import { IGPSRepository, GPSPoint } from '../interfaces';
import { RepositoryBatchResult } from '../types';

export class GPSRepository extends BaseRepository<GPSPoint> implements IGPSRepository {
  
  public async bulkInsert(points: Omit<GPSPoint, 'id'>[]): Promise<RepositoryBatchResult> {
    try {
      const operations = points.map(p => {
        const id = this.generateId();
        const metadata = this.buildMetadata();
        return {
          action: 'insert' as const,
          collection: this.collectionName,
          id,
          data: { ...p, ...metadata }
        };
      });

      // GPS points are massive. Use raw batching bypassing standard events for pure throughput.
      await this.storage.batch(operations);
      
      return { success: true, insertedCount: points.length, updatedCount: 0, deletedCount: 0 };
    } catch (e: any) {
      return { success: false, insertedCount: 0, updatedCount: 0, deletedCount: 0, error: e };
    }
  }
}

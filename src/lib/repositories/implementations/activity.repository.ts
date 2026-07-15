import { Activity } from '../../domain/entities/Activity';

export class ActivityRepository {
  async create(data: Partial<Activity>): Promise<void> {}
  
  async update(id: string, data: Partial<Activity>): Promise<void> {}
  
  // Polymorphic query to fetch timeline for ANY related entity
  async findByRelatedEntity(entityId: string, entityType: string): Promise<Activity[]> {
    return [];
  }
}

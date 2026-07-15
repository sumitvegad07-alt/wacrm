import { Activity } from '../../domain/entities/Activity';
import { TimelineEntry } from '../../domain/value-objects/TimelineEntry';

export type SyncBadgeState = 'pending' | 'uploading' | 'synced' | 'failed' | 'conflict';

export class ActivityUiDto {
  public readonly id: string;
  public readonly title: string;
  public readonly typeBadge: string;
  public readonly isOverdue: boolean;
  public readonly isCompleted: boolean;
  public readonly syncBadge: SyncBadgeState;
  
  constructor(entity: Activity) {
    this.id = entity.id;
    this.title = entity.title;
    this.typeBadge = entity.type;
    this.isCompleted = !!entity.completedAt;
    
    this.isOverdue = !this.isCompleted && !!entity.dueDate && new Date(entity.dueDate) < new Date();
    
    if (entity.sync_status === 'pending') {
      this.syncBadge = 'pending';
    } else if (entity.sync_status === 'error') {
      this.syncBadge = 'failed';
    } else if (entity.sync_status === 'conflict') {
      this.syncBadge = 'conflict';
    } else {
      this.syncBadge = 'synced';
    }
  }

  public toTimelineEntry(): TimelineEntry {
    return new TimelineEntry(
      this.id,
      new Date(), // Simplified for example
      this.typeBadge as any,
      this.title,
      this.isCompleted ? 'Completed' : 'Pending',
      this.typeBadge === 'Call' ? 'phone-icon' : 'task-icon'
    );
  }
}

import { Lead } from '../../domain/entities/Lead';

export type SyncBadgeState = 'pending' | 'uploading' | 'synced' | 'failed' | 'conflict';

export class LeadUiDto {
  public readonly id: string;
  public readonly displayName: string;
  public readonly statusBadge: string;
  public readonly syncBadge: SyncBadgeState;
  
  constructor(entity: Lead) {
    this.id = entity.id;
    this.displayName = entity.name || 'Unnamed Lead';
    this.statusBadge = entity.status.toUpperCase();
    
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
}

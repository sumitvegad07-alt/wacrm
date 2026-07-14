import { Account } from '../../../domain/entities/Account';

export type SyncBadgeState = 'pending' | 'uploading' | 'synced' | 'failed' | 'conflict';

export class AccountUiDto {
  public readonly id: string;
  public readonly formattedName: string;
  public readonly codeLabel: string;
  public readonly industryBadge: string;
  public readonly typeBadge: string;
  public readonly hasParent: boolean;
  public readonly parentId?: string;
  public readonly syncBadge: SyncBadgeState;
  
  constructor(entity: Account) {
    this.id = entity.id;
    this.formattedName = entity.name;
    this.codeLabel = entity.code ? \`[\${entity.code}]\` : '';
    this.industryBadge = entity.industry || 'Unknown Industry';
    this.typeBadge = entity.type.toUpperCase();
    this.hasParent = !!entity.parentId;
    this.parentId = entity.parentId;
    
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

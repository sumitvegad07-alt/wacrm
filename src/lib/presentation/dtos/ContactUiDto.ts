export type SyncBadgeState = 'pending' | 'uploading' | 'synced' | 'failed' | 'conflict';

export class ContactUiDto {
  public readonly id: string;
  public readonly displayName: string;
  public readonly initials: string;
  public readonly formattedPhone: string;
  public readonly syncBadge: SyncBadgeState;
  
  constructor(entity: any) {
    this.id = entity.id;
    this.displayName = entity.name || 'Unnamed Contact';
    this.initials = this.getInitials(entity.name);
    this.formattedPhone = this.formatPhone(entity.phone);
    
    // Abstracting raw runtime sync status into a friendly UI badge
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

  private getInitials(name?: string): string {
    if (!name) return '?';
    return name.substring(0, 2).toUpperCase();
  }

  private formatPhone(phone?: string): string {
    if (!phone) return 'No Phone';
    // Dummy formatting
    return phone.length === 10 ? `(${phone.substring(0,3)}) ${phone.substring(3,6)}-${phone.substring(6)}` : phone;
  }
}

export type RelationshipStatus = 'Active' | 'Inactive' | 'Historical';

export interface ContactAccountRelationship {
  id: string;
  contactId: string;
  accountId: string;
  
  roleId: string; // References ContactRoleConfiguration
  isPrimary: boolean;
  
  // Temporal lifecycle tracking
  effectiveFrom: string;
  effectiveTo?: string;
  relationshipStatus: RelationshipStatus;
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

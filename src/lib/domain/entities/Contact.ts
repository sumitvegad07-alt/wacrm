export interface Address {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

// Extensible map allows dynamically adding SMS, WhatsApp, Marketing opt-ins, etc.
export type CommunicationPreferences = Record<string, boolean>;

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  
  address?: Address;
  communicationPreferences: CommunicationPreferences;
  
  isArchived: boolean;
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}

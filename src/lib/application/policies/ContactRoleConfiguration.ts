export interface ContactRole {
  id: string;
  name: string;
  canBePrimary: boolean;
}

export interface ContactRoleConfiguration {
  roles: ContactRole[];
}

export const defaultContactRoleConfig: ContactRoleConfiguration = {
  roles: [
    { id: 'decision_maker', name: 'Decision Maker', canBePrimary: true },
    { id: 'influencer', name: 'Influencer', canBePrimary: false },
    { id: 'billing', name: 'Billing Contact', canBePrimary: true },
    { id: 'consultant', name: 'External Consultant', canBePrimary: false },
    { id: 'end_user', name: 'End User', canBePrimary: false }
  ]
};

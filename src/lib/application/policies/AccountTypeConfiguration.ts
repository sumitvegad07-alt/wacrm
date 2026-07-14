export interface AccountTypeConfiguration {
  allowedTypes: string[];
  defaultType: string;
}

export class AccountTypePolicy {
  constructor(private readonly config: AccountTypeConfiguration) {}

  public isValidType(type: string): boolean {
    return this.config.allowedTypes.includes(type);
  }

  public getDefaultType(): string {
    return this.config.defaultType;
  }
}

// Example Configuration for a standard tenant
export const defaultAccountTypeConfig: AccountTypeConfiguration = {
  allowedTypes: ['Customer', 'Prospect', 'Distributor', 'Partner', 'Vendor'],
  defaultType: 'Prospect'
};

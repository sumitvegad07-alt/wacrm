export interface LeadStatusConfiguration {
  allowedStatuses: string[];
  defaultStatus: string;
}

export class LeadStatusPolicy {
  constructor(private readonly config: LeadStatusConfiguration) {}

  public isValidTransition(currentStatus: string, newStatus: string): boolean {
    return this.config.allowedStatuses.includes(newStatus);
  }

  public getDefaultStatus(): string {
    return this.config.defaultStatus;
  }
}

// Example Configuration for the specific tenant
export const defaultLeadStatusConfig: LeadStatusConfiguration = {
  allowedStatuses: ['Prospect', 'Warm', 'Hot', 'Qualified', 'Negotiation', 'Closed'],
  defaultStatus: 'Prospect'
};

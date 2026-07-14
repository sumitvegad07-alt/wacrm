import { TimelineEvent } from './TimelineEvent';
import { HealthIndicators } from './HealthIndicators';

export interface AccountSummary {
  readonly id: string;
  readonly name: string;
  readonly industry: string;
  readonly type: string;
}

export interface ContactSummary {
  readonly primaryContactName?: string;
  readonly primaryContactEmail?: string;
  readonly totalContacts: number;
}

export interface SalesSummary {
  readonly openOpportunitiesCount: number;
  readonly openPipelineValue: number;
  readonly wonRevenueYTD: number;
  readonly activeQuotesCount: number;
  readonly completedOrdersCount: number;
}

export interface ActivitySummary {
  readonly upcomingTasksCount: number;
  readonly overdueTasksCount: number;
  readonly lastActivityDate?: string;
}

export interface TimelineSummary {
  readonly recentEvents: TimelineEvent[];
}

export interface HealthSummary {
  readonly indicators: HealthIndicators;
}

export interface Customer360Snapshot {
  readonly crmAccountId: string;
  readonly projectionVersion: number;
  readonly generatedAt: string;
  
  readonly account: AccountSummary;
  readonly contacts: ContactSummary;
  readonly sales: SalesSummary;
  readonly activity: ActivitySummary;
  readonly timeline: TimelineSummary;
  readonly health: HealthSummary;
}

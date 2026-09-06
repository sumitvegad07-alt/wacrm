import type { Bucket, Frequency } from "./analytics-period";
import type { NamedValue } from "./sfa-analytics-types";

// Shapes for the CRM analytics bundle — lead/deal/quotation/expense matrices.
// Rendered in the CRM section, so it appears on every plan that includes the
// CRM line (CRM, CRM+WFA, CRM+SFA) automatically.

export interface Slice {
  name: string;
  value: number;
}

export interface FunnelStage {
  stage: string;
  value: number;
  color?: string;
}

export interface CrmAnalytics {
  freq: Frequency;
  kpis: {
    leadVisits: number;
    newLeads: number;
    uniqueLeadVisits: number;
    convertedFromLead: number;
    newDeals: number;
    quotations: number;
    dealValue: number;
    expenseClaimed: number;
    expenseApproved: number;
    neglectedLeads: number;
  };
  leadsByStatus: Slice[];
  leadsBySource: Slice[];
  leadJourney: FunnelStage[];
  dealJourney: FunnelStage[];
  newCustomerSeries: Bucket[];
  topUsersByLead: NamedValue[];
}

export type { NamedValue };

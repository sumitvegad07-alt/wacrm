import type { Bucket, Frequency } from "./analytics-period";
import type { NamedValue } from "./sfa-analytics-types";

// Shapes for the WFA (Workforce) analytics bundle — the field-activity subset
// of the SFA analytics that applies to a workforce plan: customer visits,
// productive visits, and new customers generated in the field, plus a top
// field-agent leaderboard (the WFA parallel of "top salespeople").

export interface WfaAnalytics {
  freq: Frequency;
  kpis: {
    customerVisits: number;
    uniqueCustomerVisits: number;
    productiveVisits: number;
    totalVisits: number;
    newCustomers: number;
  };
  customerVisitSeries: Bucket[];
  newCustomerSeries: Bucket[];
  /** Total vs productive visits per period (a visit is productive if it produced an order). */
  visitProductivity: { key: string; label: string; total: number; productive: number }[];
  /** Top 5 field agents by visit count. */
  topAgents: NamedValue[];
}

export type { NamedValue };

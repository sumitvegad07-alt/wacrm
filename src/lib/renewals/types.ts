// ============================================================
// Types for the founder's renewal register.
//
// Nothing here is shared with the invoice module, on purpose: the two have no
// relationship, and a type import between them would be the first step towards
// one.
// ============================================================

import type { BillingTerm } from "@/lib/plans/pricing";

export const RENEWAL_STATUSES = [
  "active",
  "renewed",
  "in_discussion",
  "lost",
  "on_hold",
] as const;

export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const RENEWAL_STATUS_LABEL: Record<RenewalStatus, string> = {
  active: "Active",
  renewed: "Renewed",
  in_discussion: "In Discussion",
  lost: "Lost",
  on_hold: "On Hold",
};

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  company_name: string;
  plan: string;
  billing_term: BillingTerm | null;
  users: number;
  amount: number;
  /** yyyy-mm-dd. A `date` column — never parse it through `Date` to compare. */
  start_date: string;
  end_date: string;
  salesman_name: string;
  contact_person: string;
  phone: string;
  status: RenewalStatus;
  remarks: string;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodRow {
  id: string;
  subscription_id: string;
  plan: string;
  billing_term: BillingTerm | null;
  users: number;
  amount: number;
  start_date: string;
  end_date: string;
  renewed_at: string;
}

/** The tabs on the daily screen, in the order they appear. */
export const BUCKETS = ["today", "overdue", "next_7", "next_30", "all"] as const;

export type RenewalBucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<RenewalBucket, string> = {
  today: "Due Today",
  overdue: "Overdue",
  next_7: "Next 7 Days",
  next_30: "Next 30 Days",
  all: "All",
};

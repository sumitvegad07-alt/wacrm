// ============================================================
// Customer-facing labels for Getting Started's validation metrics.
//
// ONE map, next to the resolvers it labels. There used to be two -- one in
// HealthPanel, a shorter one in StepPanel -- and neither was tied to
// RESOLVERS, so every metric added after they were written fell through to
// `{label[key] ?? key}` and printed its raw database key on the onboarding
// screen. Six of the nine health tiles read `lead_count`, `deal_count`,
// `quotation_count`, `product_count`, `price_list_count` and `order_count`.
//
// `metric-labels.test.ts` fails if a resolver has no label here, so adding a
// metric without a label breaks the build instead of the first impression.
//
// Never render a raw source_key to a customer.
// ============================================================

/** Every key in RESOLVERS, in the words a customer would use. */
export const METRIC_LABELS: Record<string, string> = {
  // Masters
  territory_count: 'Territories',
  customer_count: 'Customers',
  role_count: 'Roles',
  employee_count: 'Employees',
  // CRM line
  lead_count: 'Leads',
  deal_count: 'Deals',
  quotation_count: 'Quotations',
  // Catalogue and sales
  product_count: 'Products',
  price_list_count: 'Price lists',
  order_count: 'Orders',
  // Milestones, which read as a sentence rather than a count
  employee_logged_in: 'Team member logged in',
  attendance_or_visit: 'First activity recorded',
  meaningful_data: 'Live data flowing',
  // The answer resolver is not a tile; labelled so the test needs no exceptions.
  answer: 'Your answer',
};

/**
 * The label for a metric. Falls back to the key only for something genuinely
 * unknown -- which the test makes impossible for anything in RESOLVERS.
 */
export function metricLabel(sourceKey: string): string {
  return METRIC_LABELS[sourceKey] ?? sourceKey;
}

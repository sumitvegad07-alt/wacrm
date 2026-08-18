import { describe, it, expect } from 'vitest';
import { dsrReportConfig } from '@/lib/reports/dsrReportConfig';

describe('DSR report', () => {
  it('declares every key its tabs use', () => {
    const measureKeys = new Set(dsrReportConfig.measures.map((m) => m.key));
    const dimensionKeys = new Set(dsrReportConfig.dimensions.map((d) => d.key));

    dsrReportConfig.tabConfigs?.forEach((tab) => {
      expect(dimensionKeys, `${tab.key} dimension`).toContain(tab.dimension);
      tab.defaultMeasures.forEach((m) =>
        expect(measureKeys, `${tab.key} measure ${m}`).toContain(m)
      );
    });
    dsrReportConfig.kpis.forEach((k) => expect(measureKeys, `kpi ${k}`).toContain(k));
  });

  it('opens on today, because it is a DAILY report', () => {
    // Every other report opens on this_month. A daily report that opened on a
    // month would answer a different question than its name.
    expect(dsrReportConfig.defaultPeriod).toBe('today');
  });

  it('carries every column the founder specified', () => {
    // The agreed DSR line. A column silently dropped from the default set is a
    // column nobody knows to go looking for in Manage Column.
    const required = [
      'assigned_customers', 'visited_customers', 'missed_customers',
      'days_present', 'leave_days', 'total_visits', 'productive_visits',
      'distance_km', 'new_customers', 'order_amount', 'order_quantity',
      'payment_collected', 'new_leads', 'lead_visits', 'quotation_amount',
      'approved_quotation_amount', 'new_deals', 'deal_amount',
    ];
    const userTab = dsrReportConfig.tabConfigs?.find((t) => t.key === 'user');
    required.forEach((key) =>
      expect(userTab?.defaultMeasures, `DSR is missing ${key}`).toContain(key)
    );
  });

  it('exposes the full status pivot for payments and expenses', () => {
    // The founder asked for each module's status split. Payments have a fourth
    // state (Cancelled) that is EXCLUDED from Collected, so it must be visible
    // somewhere or the money silently disappears from the report.
    const keys = dsrReportConfig.measures.map((m) => m.key);
    ['payment_collected', 'payment_approved', 'payment_pending', 'payment_rejected', 'payment_cancelled']
      .forEach((k) => expect(keys, `missing ${k}`).toContain(k));
    ['expense_claimed', 'expense_approved', 'expense_pending', 'expense_rejected']
      .forEach((k) => expect(keys, `missing ${k}`).toContain(k));
  });

  it('charts a measure worth charting, not the first column', () => {
    // The fallback is measures[0] = "Assigned Customers (Current)", a snapshot
    // identical every day and meaningless as a pie.
    expect(dsrReportConfig.defaultChartMeasure).toBe('order_amount');
    const userTab = dsrReportConfig.tabConfigs?.find((t) => t.key === 'user');
    expect(userTab?.defaultMeasures).toContain(dsrReportConfig.defaultChartMeasure!);
  });

  it('labels the period-independent and derived columns honestly', () => {
    // Assigned is a snapshot with no assignment history behind it, so it reads
    // the same for Today as for last year; saying so in the header is the only
    // place a reader sees it. "Missed" was renamed because over one day it
    // counts customers simply not reached, not failures against a plan.
    const byKey = new Map(dsrReportConfig.measures.map((m) => [m.key, m.label]));
    expect(byKey.get('assigned_customers')).toMatch(/current/i);
    expect(byKey.get('missed_customers')).toBe('Not Visited');
  });

  it('has no Employee Status filter', () => {
    // Dropped at the founder's request — every prod profile is 'active', so it
    // was a filter with one meaningful value.
    expect(dsrReportConfig.filters.map((f) => f.key)).not.toContain('employee_status');
  });

  it('never offers Area as a grouping, only as a filter', () => {
    // employee_area_assignments is many-to-many — same rule as the Expense
    // report (§5h). Grouping would multiply every amount.
    const dimensionKeys = dsrReportConfig.dimensions.map((d) => d.key);
    ['area', 'city', 'state', 'country'].forEach((k) =>
      expect(dimensionKeys, `${k} must not be groupable`).not.toContain(k)
    );
    expect(dsrReportConfig.filters.map((f) => f.key)).toContain('area');
  });

  it('types money as currency and counts as number', () => {
    const byKey = new Map(dsrReportConfig.measures.map((m) => [m.key, m.type]));
    ['order_amount', 'payment_collected', 'expense_claimed', 'quotation_amount', 'deal_amount']
      .forEach((k) => expect(byKey.get(k), `${k} should be currency`).toBe('currency'));
    ['total_visits', 'days_present', 'distance_km', 'order_quantity', 'new_leads']
      .forEach((k) => expect(byKey.get(k), `${k} should be number`).toBe('number'));
  });
});

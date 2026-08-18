import { describe, it, expect } from 'vitest';
import { expenseReportConfig } from '@/lib/reports/expenseReportConfig';

describe('Expense report', () => {
  it('declares every key its tabs use', () => {
    const measureKeys = new Set(expenseReportConfig.measures.map((m) => m.key));
    const dimensionKeys = new Set(expenseReportConfig.dimensions.map((d) => d.key));

    expenseReportConfig.tabConfigs?.forEach((tab) => {
      expect(dimensionKeys, `${tab.key} dimension`).toContain(tab.dimension);
      tab.defaultMeasures.forEach((m) =>
        expect(measureKeys, `${tab.key} measure ${m}`).toContain(m)
      );
    });
    expenseReportConfig.kpis.forEach((k) =>
      expect(measureKeys, `kpi ${k}`).toContain(k)
    );
  });

  it('shows the whole status pivot on every tab', () => {
    // Total = Pending + Approved + Rejected only holds if the reader can see all
    // four. Dropping one from a tab leaves a row that silently fails to add up.
    const pivot = ['pending_amount', 'approved_amount', 'rejected_amount', 'total_amount'];
    expenseReportConfig.tabConfigs?.forEach((tab) => {
      pivot.forEach((key) =>
        expect(tab.defaultMeasures, `${tab.key} is missing ${key}`).toContain(key)
      );
    });
  });

  it('covers exactly the three expense statuses', () => {
    // expense_status_type is Pending | Approved | Rejected. A fourth status added
    // to the enum without a matching column would vanish from Total silently.
    const statusFilter = expenseReportConfig.filters.find((f) => f.key === 'status');
    expect(statusFilter?.options?.map((o) => o.value).sort()).toEqual([
      'Approved',
      'Pending',
      'Rejected',
    ]);
  });

  it('never offers Area as a grouping, only as a filter', () => {
    // employee_area_assignments is many-to-many (one prod employee covers six
    // areas), so grouping expenses by area would multiply the amounts. Area is
    // registered as an EXISTS filter instead.
    const dimensionKeys = expenseReportConfig.dimensions.map((d) => d.key);
    ['area', 'city', 'state', 'country'].forEach((key) =>
      expect(dimensionKeys, `${key} must not be groupable`).not.toContain(key)
    );
    expenseReportConfig.tabConfigs?.forEach((tab) =>
      expect(['area', 'city', 'state', 'country']).not.toContain(tab.dimension)
    );

    const filterKeys = expenseReportConfig.filters.map((f) => f.key);
    expect(filterKeys).toContain('area');
  });

  it('labels the claimant "User", matching every other report', () => {
    const tab = expenseReportConfig.tabConfigs?.find((t) => t.key === 'user');
    expect(tab?.label).toBe('User');
    expect(expenseReportConfig.dimensions.find((d) => d.key === 'user')?.label).toBe('User');
    // The approver is a different person and keeps its own label.
    expect(expenseReportConfig.tabConfigs?.find((t) => t.key === 'approver')?.label)
      .toBe('Approved By');
  });

  it('registers the approval ratio as a percent so it is never summed', () => {
    const ratio = expenseReportConfig.measures.find((m) => m.key === 'approval_ratio');
    expect(ratio?.type).toBe('percent');
  });

  it('points the expense-type picker at the column that actually holds the label', () => {
    // expense_types has expense_name, not name; the default would render blanks.
    const typeFilter = expenseReportConfig.filters.find((f) => f.key === 'expense_type');
    expect(typeFilter?.lookupTable).toBe('expense_types');
    expect(typeFilter?.lookupDisplayColumn).toBe('expense_name');
    expect(typeFilter?.lookupValueColumn).toBe('id');
  });
});

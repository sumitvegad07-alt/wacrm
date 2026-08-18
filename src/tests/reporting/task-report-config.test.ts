import { describe, it, expect } from 'vitest';
import { taskReportConfig } from '@/lib/reports/taskReportConfig';

describe('Task report', () => {
  it('declares every key its tabs use', () => {
    const measureKeys = new Set(taskReportConfig.measures.map((m) => m.key));
    const dimensionKeys = new Set(taskReportConfig.dimensions.map((d) => d.key));

    taskReportConfig.tabConfigs?.forEach((tab) => {
      expect(dimensionKeys, `${tab.key} dimension`).toContain(tab.dimension);
      tab.defaultMeasures.forEach((m) =>
        expect(measureKeys, `${tab.key} measure ${m}`).toContain(m)
      );
    });
    taskReportConfig.kpis.forEach((k) => expect(measureKeys, `kpi ${k}`).toContain(k));
  });

  it('shows the completion picture on every tab except Status', () => {
    const core = ['task_count', 'done_count', 'undone_count', 'overdue_count'];
    taskReportConfig.tabConfigs
      ?.filter((t) => t.key !== 'status')
      .forEach((tab) => {
        core.forEach((key) =>
          expect(tab.defaultMeasures, `${tab.key} is missing ${key}`).toContain(key)
        );
      });

    // Completed/pending columns on a Status grouping would restate the row's own
    // name, so that tab counts and nothing else.
    const status = taskReportConfig.tabConfigs?.find((t) => t.key === 'status');
    expect(status?.defaultMeasures).not.toContain('done_count');
    expect(status?.defaultMeasures).toContain('task_count');
  });

  it('reduces status to Done / Undone, with All meaning "unset"', () => {
    // Founder decision 2026-08-18. The tasks table still stores five statuses;
    // the report exposes two, and "All" is simply leaving the filter unset.
    const statuses = taskReportConfig.filters
      .find((f) => f.key === 'status')?.options?.map((o) => o.value);
    expect(statuses).toEqual(['Done', 'Undone']);
  });

  it('offers a Lead filter, not just a Customer one', () => {
    // A task belongs to a lead OR a customer; filtering by only one half made
    // the Lead tab unfilterable.
    const filterKeys = taskReportConfig.filters.map((f) => f.key);
    expect(filterKeys).toContain('lead');
    expect(filterKeys).toContain('customer');
  });

  it('builds activity types from account settings, not a hardcoded list', () => {
    // accounts.settings.task_types is per-account — this account uses "Payment
    // follow up", which is not among the shipped defaults, so a static list
    // would make its own tasks unfilterable.
    const activity = taskReportConfig.filters.find((f) => f.key === 'activity_type');
    expect(activity?.optionsFromSettings).toBe('task_types');
    // The hardcoded list survives only as a fallback.
    expect(activity?.options?.length).toBeGreaterThan(0);
  });

  it('registers the completion ratio as a percent so it is never summed', () => {
    expect(taskReportConfig.measures.find((m) => m.key === 'completion_ratio')?.type)
      .toBe('percent');
  });

  it('keeps overdue out of the reconciling bucket set', () => {
    // done + undone = task_count. Overdue is a SUBSET of undone, so it must
    // never be presented as a third bucket, and no other bucket may exist.
    const keys = taskReportConfig.measures.map((m) => m.key);
    expect(keys).toContain('overdue_count');
    expect(keys).not.toContain('cancelled_count');
    expect(keys).not.toContain('pending_count');
    expect(keys).not.toContain('completed_count');
  });
});

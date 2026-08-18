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
    const core = ['task_count', 'completed_count', 'pending_count', 'overdue_count'];
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
    expect(status?.defaultMeasures).not.toContain('completed_count');
    expect(status?.defaultMeasures).toContain('task_count');
  });

  it('covers exactly the five task statuses the form can set', () => {
    // src/components/tasks/task-form.tsx STATUSES. A status missing here is a
    // status nobody can filter by.
    const statuses = taskReportConfig.filters
      .find((f) => f.key === 'status')?.options?.map((o) => o.value);
    expect(statuses).toEqual(['Pending', 'In Progress', 'Waiting', 'Completed', 'Cancelled']);
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
    // completed + pending + cancelled = task_count. Overdue is a SUBSET of
    // pending, so it must never be presented as a fourth bucket.
    const keys = taskReportConfig.measures.map((m) => m.key);
    expect(keys).toContain('cancelled_count');
    expect(keys).toContain('overdue_count');
    // Guard the intent: overdue is a default column but not part of the sum.
    const user = taskReportConfig.tabConfigs?.find((t) => t.key === 'user');
    expect(user?.defaultMeasures).toContain('overdue_count');
    expect(user?.defaultMeasures).not.toContain('cancelled_count');
  });
});

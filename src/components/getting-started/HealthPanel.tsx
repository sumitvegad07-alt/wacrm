'use client';
import type { EvaluatedStep } from '@/lib/implementation/types';

export function HealthPanel({ steps }: { steps: EvaluatedStep[] }) {
  // Roles are not prescriptive — there's no "right" number of roles for an
  // account, so we never nag with a recommended target (founder decision). Show
  // the count with a plain green tick, exactly like Territories.
  const NON_PRESCRIPTIVE = new Set(['role_count']);
  const metrics = steps.flatMap((s) => s.ruleResults
    .filter((r) => r.recommendedThreshold != null)
    .map((r) => ({
      key: r.source_key,
      value: typeof r.value === 'number' ? r.value : (r.value ? 1 : 0),
      rec: r.recommendedThreshold!,
      ok: NON_PRESCRIPTIVE.has(r.source_key) ? true : r.recommendedPass === true,
    })));
  if (metrics.length === 0) return null;
  const label: Record<string, string> = { territory_count: 'Territories', customer_count: 'Customers', employee_count: 'Employees', role_count: 'Roles' };
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span>{label[m.key] ?? m.key}</span>
          <span className={m.ok ? 'text-green-600' : 'text-amber-600'}>{m.value}{m.ok ? ' ✓' : ` ⚠️ (rec ${m.rec})`}</span>
        </div>
      ))}
    </div>
  );
}

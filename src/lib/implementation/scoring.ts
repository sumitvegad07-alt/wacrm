import type { EvaluatedStep } from './types';

const RESOLVED = new Set(['completed', 'auto_completed', 'skipped']);
const CREDITED = new Set(['completed', 'auto_completed']);
const applicable = (steps: EvaluatedStep[]) => steps.filter((s) => s.applicable);

export function computeProgressPct(steps: EvaluatedStep[]): number {
  const app = applicable(steps);
  const denom = app.reduce((a, s) => a + s.step.weight, 0);
  if (denom === 0) return 0;
  const num = app.filter((s) => RESOLVED.has(s.status)).reduce((a, s) => a + s.step.weight, 0);
  return Math.round((100 * num) / denom);
}

export function computeScore(steps: EvaluatedStep[]): number {
  const app = applicable(steps);
  const denom = app.reduce((a, s) => a + s.step.weight, 0);
  if (denom === 0) return 0;
  const num = app.filter((s) => CREDITED.has(s.status)).reduce((a, s) => a + s.step.weight, 0);
  return Math.round((100 * num) / denom);
}

export function computeHealthPct(steps: EvaluatedStep[]): number {
  let wsum = 0;
  let acc = 0;
  for (const s of applicable(steps)) {
    for (const r of s.ruleResults) {
      if (r.recommendedThreshold == null || r.healthWeight == null) continue;
      const val = typeof r.value === 'number' ? r.value : r.value ? 1 : 0;
      const attainment = r.recommendedThreshold === 0 ? 1 : Math.min(1, val / r.recommendedThreshold);
      acc += r.healthWeight * attainment;
      wsum += r.healthWeight;
    }
  }
  if (wsum === 0) return 0;
  return Math.round((100 * acc) / wsum);
}

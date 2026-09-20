import { describe, it, expect } from 'vitest';
import { computeProgressPct, computeScore, computeHealthPct } from './scoring';
import type { EvaluatedStep, TemplateStep } from './types';

function step(partial: Partial<TemplateStep> & { weight: number }): TemplateStep {
  return {
    id: partial.id ?? 's', template_id: 't', position: 0, step_key: partial.step_key ?? 'k',
    step_type: 'task', title: '', description: null, video_url: null, quick_steps: [],
    help_text: null, help_context: null, estimated_minutes: 0, is_optional: false,
    auto_complete: true, weight: partial.weight, tasks: [], questions: [], media: [],
    rules: [], conditions: [],
  };
}
function ev(status: EvaluatedStep['status'], weight: number, applicable = true, rules: EvaluatedStep['ruleResults'] = []): EvaluatedStep {
  return { step: step({ weight }), applicable, status, ruleResults: rules, requiredSatisfied: status === 'completed' || status === 'auto_completed' };
}

describe('computeProgressPct', () => {
  it('counts completed, auto_completed and skipped as resolved over applicable', () => {
    const steps = [ev('completed', 1), ev('auto_completed', 1), ev('skipped', 1), ev('available', 1)];
    expect(computeProgressPct(steps)).toBe(75);
  });
  it('excludes non-applicable steps from the denominator', () => {
    const steps = [ev('completed', 1), ev('available', 1, false)];
    expect(computeProgressPct(steps)).toBe(100);
  });
  it('is 0 when nothing applicable', () => {
    expect(computeProgressPct([ev('available', 1, false)])).toBe(0);
  });
});

describe('computeScore', () => {
  it('gives skipped steps zero credit (score < progress when skipping)', () => {
    const steps = [ev('completed', 1), ev('skipped', 1)];
    expect(computeProgressPct(steps)).toBe(100);
    expect(computeScore(steps)).toBe(50);
  });
  it('weights steps', () => {
    const steps = [ev('auto_completed', 3), ev('available', 1)];
    expect(computeScore(steps)).toBe(75);
  });
});

describe('computeHealthPct', () => {
  it('averages attainment vs recommended, capped at 100 per metric', () => {
    const steps = [
      ev('completed', 1, true, [{ source_key: 'territory_count', value: 5, requiredPass: true, recommendedPass: true, recommendedThreshold: 5, healthWeight: 1 }]),
      ev('completed', 1, true, [{ source_key: 'customer_count', value: 50, requiredPass: true, recommendedPass: false, recommendedThreshold: 100, healthWeight: 1 }]),
    ];
    // (min(1,5/5)=1  + min(1,50/100)=0.5) / 2 = 0.75
    expect(computeHealthPct(steps)).toBe(75);
  });
  it('ignores rules without a recommended threshold', () => {
    const steps = [ev('completed', 1, true, [{ source_key: 'x', value: true, requiredPass: true, recommendedPass: null, recommendedThreshold: null, healthWeight: null }])];
    expect(computeHealthPct(steps)).toBe(0);
  });
});

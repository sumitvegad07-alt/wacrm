import { describe, it, expect } from 'vitest';
import { evaluateRules, evaluateTemplate } from './evaluate';
import type { TemplateDefinition, TemplateStep, ValidationRule } from './types';
import type { ResolverCtx } from './resolvers';

// Inject a fake resolver map so the test never touches Supabase.
const fakeCtx = (): ResolverCtx => ({ accountId: 'acc', supabase: {} as never, params: null, answers: {} });

// evaluate.ts accepts an optional resolver override for testability.
const override = (values: Record<string, number | boolean>) =>
  async (sourceKey: string) => { if (!(sourceKey in values)) throw new Error(sourceKey); return values[sourceKey]; };

function mkStep(p: Partial<TemplateStep> & { step_key: string; rules: ValidationRule[] }): TemplateStep {
  return {
    id: p.step_key, template_id: 't', position: p.position ?? 0, step_key: p.step_key, step_type: 'task',
    title: '', description: null, video_url: null, quick_steps: [], help_text: null, help_context: null,
    estimated_minutes: 0, is_optional: p.is_optional ?? false, auto_complete: p.auto_complete ?? true, weight: p.weight ?? 1,
    tasks: [], questions: [], media: [], rules: p.rules, conditions: p.conditions ?? [],
  };
}
const rule = (source_key: string, extra: Partial<ValidationRule> = {}): ValidationRule =>
  ({ id: source_key, step_id: 's', source_key, operator: extra.operator ?? 'gt', required_threshold: extra.required_threshold ?? 0,
    recommended_threshold: extra.recommended_threshold ?? null, health_weight: extra.health_weight ?? null,
    params: extra.params ?? null, combine: extra.combine ?? 'and' });

describe('evaluateRules', () => {
  it('gt threshold passes when value exceeds', async () => {
    const step = mkStep({ step_key: 'a', rules: [rule('territory_count', { operator: 'gt', required_threshold: 0 })] });
    const r = await evaluateRules(step, fakeCtx(), override({ territory_count: 3 }));
    expect(r.requiredSatisfied).toBe(true);
    expect(r.ruleResults[0].value).toBe(3);
  });
  it('exists false → not satisfied', async () => {
    const step = mkStep({ step_key: 'b', rules: [rule('meaningful_data', { operator: 'exists' })] });
    const r = await evaluateRules(step, fakeCtx(), override({ meaningful_data: false }));
    expect(r.requiredSatisfied).toBe(false);
  });
  it('baseline: count must grow beyond enrollment baseline (defaults ignored)', async () => {
    const step = mkStep({ step_key: 'c', rules: [rule('territory_count', { operator: 'gt', required_threshold: 0 })] });
    // baseline 3 default territories: value 3 is NOT net-new, value 4 is.
    expect((await evaluateRules(step, fakeCtx(), override({ territory_count: 3 }), { territory_count: 3 })).requiredSatisfied).toBe(false);
    expect((await evaluateRules(step, fakeCtx(), override({ territory_count: 4 }), { territory_count: 3 })).requiredSatisfied).toBe(true);
  });
  it('baseline: exists must appear since enrollment', async () => {
    const step = mkStep({ step_key: 'd', rules: [rule('employee_logged_in', { operator: 'exists' })] });
    // already true at baseline → not net-new; true when baseline was false → pass.
    expect((await evaluateRules(step, fakeCtx(), override({ employee_logged_in: true }), { employee_logged_in: true })).requiredSatisfied).toBe(false);
    expect((await evaluateRules(step, fakeCtx(), override({ employee_logged_in: true }), { employee_logged_in: false })).requiredSatisfied).toBe(true);
  });
});

describe('evaluateTemplate', () => {
  const def: TemplateDefinition = {
    id: 't', product_line: 'wfa', template_key: 'wfa_v1', version: 1, name: 'x', display_name: 'X',
    description: null, estimated_minutes: 0, support_whatsapp_url: null, milestones: [],
    steps: [
      mkStep({ step_key: 's1', position: 1, rules: [rule('territory_count', { required_threshold: 0, recommended_threshold: 5, health_weight: 1 })] }),
      mkStep({ step_key: 's2', position: 2, rules: [rule('customer_count', { required_threshold: 0 })] }),
    ],
  };
  it('auto-completes satisfied steps and advances currentStep', async () => {
    const out = await evaluateTemplate(def, {}, {}, fakeCtx(), override({ territory_count: 5, customer_count: 0 }));
    expect(out.steps[0].status).toBe('auto_completed');
    expect(out.steps[1].status).toBe('available');
    expect(out.currentStepId).toBe('s2');
    expect(out.progressPct).toBe(50);
    expect(out.completed).toBe(false);
  });
  it('respects prior completed/skipped statuses', async () => {
    const out = await evaluateTemplate(def, {}, { s2: 'skipped' }, fakeCtx(), override({ territory_count: 5, customer_count: 0 }));
    expect(out.steps[1].status).toBe('skipped');
    expect(out.completed).toBe(true); // s1 auto, s2 skipped → all applicable resolved
  });
  it('marks completed and computes health', async () => {
    const out = await evaluateTemplate(def, {}, {}, fakeCtx(), override({ territory_count: 5, customer_count: 10 }));
    expect(out.completed).toBe(true);
    expect(out.healthPct).toBe(100); // 5/5 recommended
  });
});

import { describe, it, expect } from 'vitest';
import { isStepApplicable, matchesCondition } from './conditions';
import type { StepCondition, TemplateStep } from './types';

const baseStep = (conditions: StepCondition[]): TemplateStep => ({
  id: 's', template_id: 't', position: 0, step_key: 'k', step_type: 'task', title: '',
  description: null, video_url: null, quick_steps: [], help_text: null, help_context: null,
  estimated_minutes: 0, is_optional: false, auto_complete: true, weight: 1,
  tasks: [], questions: [], media: [], rules: [], conditions,
});
const cond = (c: Partial<StepCondition>): StepCondition => ({
  id: 'c', step_id: 's', depends_on_question_key: 'method', comparator: 'eq', value: 'area_wise', effect: 'show', ...c,
});

describe('matchesCondition', () => {
  it('eq matches', () => expect(matchesCondition(cond({ comparator: 'eq', value: 'area_wise' }), { method: 'area_wise' })).toBe(true));
  it('neq matches when different', () => expect(matchesCondition(cond({ comparator: 'neq', value: 'direct' }), { method: 'area_wise' })).toBe(true));
  it('in matches membership', () => expect(matchesCondition(cond({ comparator: 'in', value: ['a', 'area_wise'] }), { method: 'area_wise' })).toBe(true));
  it('truthy matches non-empty', () => expect(matchesCondition(cond({ comparator: 'truthy' }), { method: 'x' })).toBe(true));
});

describe('isStepApplicable', () => {
  it('is applicable with no conditions', () => expect(isStepApplicable(baseStep([]), {})).toBe(true));
  it('show + match → applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'show' })]), { method: 'area_wise' })).toBe(true));
  it('show + no match → not applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'show' })]), { method: 'direct' })).toBe(false));
  it('hide + match → not applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'hide' })]), { method: 'area_wise' })).toBe(false));
  it('hide + no match → applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'hide' })]), { method: 'direct' })).toBe(true));
});

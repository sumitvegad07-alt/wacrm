import type { StepCondition, TemplateStep, AnswerMap } from './types';

export function matchesCondition(c: StepCondition, answers: AnswerMap): boolean {
  const a = answers[c.depends_on_question_key];
  switch (c.comparator) {
    case 'eq': return a === c.value;
    case 'neq': return a !== c.value;
    case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(a);
    case 'not_in': return Array.isArray(c.value) && !(c.value as unknown[]).includes(a);
    case 'truthy': return a !== undefined && a !== null && a !== '' && a !== false;
    default: return false;
  }
}

// A step is applicable unless a hide/skip condition matches, or a show condition
// is present and does NOT match. Multiple conditions AND together.
export function isStepApplicable(step: TemplateStep, answers: AnswerMap): boolean {
  for (const c of step.conditions) {
    const m = matchesCondition(c, answers);
    if ((c.effect === 'hide' || c.effect === 'skip') && m) return false;
    if (c.effect === 'show' && !m) return false;
  }
  return true;
}

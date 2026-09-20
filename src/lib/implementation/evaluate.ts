import type {
  TemplateDefinition, TemplateStep, EvaluatedStep, EvaluatedTemplate,
  RuleEvaluation, StepStatus, AnswerMap, BaselineMap, ResolverOverride,
} from './types';
import { runResolver, type ResolverCtx } from './resolvers';
import { isStepApplicable } from './conditions';
import { computeProgressPct, computeScore, computeHealthPct } from './scoring';

const RESOLVED = new Set<StepStatus>(['completed', 'auto_completed', 'skipped']);
const num = (v: number | boolean | undefined) => (typeof v === 'number' ? v : v ? 1 : 0);

// A rule passes only for NET-NEW work beyond the enrollment baseline, so
// pre-existing defaults never auto-complete a step.
function ruleRequiredPass(op: string, value: number | boolean, threshold: number | null, baseline: number | boolean | undefined): boolean {
  if (op === 'exists') {
    const cur = value === true || (typeof value === 'number' && value > 0);
    const base = baseline === true || (typeof baseline === 'number' && baseline > 0);
    return cur && !base; // appeared since enrollment
  }
  const v = num(value);
  const b = num(baseline);
  const floor = Math.max(threshold ?? 0, b); // beyond both the required threshold and the baseline
  if (op === 'gt') return v > floor;
  if (op === 'gte') return v >= Math.max(threshold ?? 0, b + 1);
  if (op === 'eq') return v === (threshold ?? 0);
  return false;
}

export async function evaluateRules(
  step: TemplateStep, ctx: ResolverCtx,
  resolver: ResolverOverride = (k, p) => runResolver(k, { ...ctx, params: p ?? null }),
  baseline: BaselineMap = {},
): Promise<{ ruleResults: RuleEvaluation[]; requiredSatisfied: boolean }> {
  const ruleResults: RuleEvaluation[] = [];
  const passes: boolean[] = [];
  let combine: 'and' | 'or' = 'and';
  for (const rule of step.rules) {
    combine = rule.combine;
    const value = await resolver(rule.source_key, rule.params);
    const requiredPass = ruleRequiredPass(rule.operator, value, rule.required_threshold, baseline[rule.source_key]);
    const numeric = typeof value === 'number' ? value : value ? 1 : 0;
    const recommendedPass = rule.recommended_threshold == null ? null : numeric >= rule.recommended_threshold;
    ruleResults.push({
      source_key: rule.source_key, value, requiredPass, recommendedPass,
      recommendedThreshold: rule.recommended_threshold, healthWeight: rule.health_weight,
    });
    passes.push(requiredPass);
  }
  const requiredSatisfied = step.rules.length === 0
    ? true
    : combine === 'or' ? passes.some(Boolean) : passes.every(Boolean);
  return { ruleResults, requiredSatisfied };
}

export async function evaluateTemplate(
  def: TemplateDefinition,
  answers: AnswerMap,
  priorStatuses: Record<string, StepStatus>,
  ctx: ResolverCtx,
  resolver?: ResolverOverride,
  baseline: BaselineMap = {},
): Promise<EvaluatedTemplate> {
  const baseResolver: ResolverOverride = resolver ?? ((k, p) => runResolver(k, { ...ctx, answers, params: p ?? null }));
  const sorted = [...def.steps].sort((a, b) => a.position - b.position);

  // Applicability is pure (answers only). Compute it first so we only run
  // resolvers for steps that actually apply.
  const applicableMap = new Map(sorted.map((s) => [s.id, isStepApplicable(s, answers)]));

  // Resolver values depend only on (source_key, params) — not on which step
  // asked — so resolve every DISTINCT job ONCE and in PARALLEL. This turns the
  // old N-sequential-round-trips (slow to Singapore) into a single parallel wave.
  const cacheKey = (k: string, p: unknown) => `${k}::${JSON.stringify(p ?? null)}`;
  const jobs = new Map<string, { k: string; p: Record<string, unknown> | null }>();
  for (const s of sorted) {
    if (!applicableMap.get(s.id)) continue;
    for (const rule of s.rules) jobs.set(cacheKey(rule.source_key, rule.params), { k: rule.source_key, p: rule.params });
  }
  const resolvedEntries = await Promise.all(
    [...jobs].map(async ([ck, { k, p }]) => [ck, await baseResolver(k, p)] as const),
  );
  const cache = new Map(resolvedEntries);
  const cachedResolver: ResolverOverride = async (k, p) => {
    const v = cache.get(cacheKey(k, p));
    if (v === undefined) throw new Error(`resolver cache miss: ${k}`);
    return v;
  };

  const steps: EvaluatedStep[] = [];
  for (const step of sorted) {
    const applicable = applicableMap.get(step.id) ?? false;
    const { ruleResults, requiredSatisfied } = applicable
      ? await evaluateRules(step, { ...ctx, answers }, cachedResolver, baseline)
      : { ruleResults: [], requiredSatisfied: false };
    const prior = priorStatuses[step.id];
    let status: StepStatus;
    if (!applicable) status = 'locked';
    else if (prior === 'completed' || prior === 'skipped') status = prior;
    else if (step.auto_complete && requiredSatisfied) status = 'auto_completed';
    else if (prior === 'in_progress') status = 'in_progress';
    else status = 'available';
    steps.push({ step, applicable, status, ruleResults, requiredSatisfied });
  }
  const currentStep = steps.find((s) => s.applicable && !RESOLVED.has(s.status));
  const applicableSteps = steps.filter((s) => s.applicable);
  const completed = applicableSteps.length > 0 && applicableSteps.every((s) => RESOLVED.has(s.status));
  return {
    template: def, steps,
    progressPct: computeProgressPct(steps),
    score: computeScore(steps),
    healthPct: computeHealthPct(steps),
    currentStepId: currentStep?.step.id ?? null,
    completed,
  };
}

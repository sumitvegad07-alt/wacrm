'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { evaluateTemplate } from '@/lib/implementation/evaluate';
import { templateLineAllowed } from '@/lib/implementation/access';
import type {
  TemplateDefinition, TemplateStep, AnswerMap, StepStatus, EvaluatedTemplate,
  Milestone, AnalyticsEventType, BaselineMap,
} from '@/lib/implementation/types';
import { runResolver, type ResolverCtx } from '@/lib/implementation/resolvers';

const TEMPLATE_KEY = 'wfa_v1';
const ROUTE = '/getting-started';

type SB = Awaited<ReturnType<typeof createClient>>;

// --- helpers -------------------------------------------------------------
async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile } = await supabase
    .from('profiles').select('id, account_id, account_role').eq('user_id', user.id).single();
  if (!profile?.account_id) throw new Error('No account');
  return { supabase, actorId: profile.id as string, accountId: profile.account_id as string };
}

async function logEvent(
  supabase: SB, accountId: string, actorId: string,
  templateId: string | null, progressId: string | null, stepId: string | null,
  eventType: AnalyticsEventType, metadata: Record<string, unknown> = {},
) {
  await supabase.from('impl_analytics_events').insert({
    account_id: accountId, actor_id: actorId, template_id: templateId,
    progress_id: progressId, step_id: stepId, event_type: eventType, metadata,
  });
}

// Assemble the nested TemplateDefinition from its definition tables.
async function loadDefinition(supabase: SB): Promise<TemplateDefinition | null> {
  const { data: tpl } = await supabase
    .from('impl_templates').select('*')
    .eq('template_key', TEMPLATE_KEY).eq('is_active', true)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (!tpl) return null;
  const { data: steps } = await supabase.from('impl_steps').select('*').eq('template_id', tpl.id).order('position');
  const stepIds = (steps ?? []).map((s) => s.id);
  const inStep = (t: string) => supabase.from(t).select('*').in('step_id', stepIds);
  const [tasks, questions, media, rules, conditions, milestones] = await Promise.all([
    inStep('impl_step_tasks'), inStep('impl_step_questions'), inStep('impl_step_media'),
    inStep('impl_validation_rules'), inStep('impl_conditions'),
    supabase.from('impl_milestones').select('*').eq('template_id', tpl.id).order('position'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are dynamically shaped DB rows
  const by = (rows: any[] | null, id: string) => (rows ?? []).filter((r) => r.step_id === id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assembling typed nested shape from DB rows
  const fullSteps: TemplateStep[] = (steps ?? []).map((s: any) => ({
    ...s, quick_steps: (s.quick_steps as string[]) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sort over DB rows
    tasks: by(tasks.data, s.id).sort((a: any, b: any) => a.position - b.position),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sort over DB rows
    questions: by(questions.data, s.id).sort((a: any, b: any) => a.position - b.position),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sort over DB rows
    media: by(media.data, s.id).sort((a: any, b: any) => a.position - b.position),
    rules: by(rules.data, s.id), conditions: by(conditions.data, s.id),
  })) as TemplateStep[];
  return { ...tpl, steps: fullSteps, milestones: (milestones.data ?? []) as Milestone[] } as TemplateDefinition;
}

// Snapshot every count/exists resolver value at enrollment. A step later
// completes only when its value grows beyond this baseline, so pre-existing
// defaults (seeded territories, the admin user, default roles) don't pre-tick.
async function computeBaseline(supabase: SB, accountId: string, def: TemplateDefinition): Promise<BaselineMap> {
  const keys = new Map<string, Record<string, unknown> | null>();
  for (const s of def.steps) for (const r of s.rules) if (r.source_key !== 'answer') keys.set(r.source_key, r.params);
  const ctx: ResolverCtx = { accountId, supabase: supabase as never, params: null, answers: {} };
  const entries = await Promise.all(
    [...keys].map(async ([k, p]) => [k, await runResolver(k, { ...ctx, params: p ?? null })] as const),
  );
  return Object.fromEntries(entries);
}

async function getOrCreateProgress(supabase: SB, accountId: string, def: TemplateDefinition, actorId: string) {
  const { data: existing } = await supabase.from('impl_progress').select('*')
    .eq('account_id', accountId).eq('template_key', TEMPLATE_KEY).maybeSingle();
  if (existing) {
    // Backfill baseline once for rows enrolled before the baseline column existed.
    if (existing.baseline == null) {
      const baseline = await computeBaseline(supabase, accountId, def);
      await supabase.from('impl_progress').update({ baseline }).eq('id', existing.id);
      existing.baseline = baseline;
    }
    return existing;
  }
  const baseline = await computeBaseline(supabase, accountId, def);
  const { data: created } = await supabase.from('impl_progress').insert({
    account_id: accountId, template_id: def.id, template_key: TEMPLATE_KEY, template_version: def.version,
    status: 'in_progress', baseline,
  }).select('*').single();
  await logEvent(supabase, accountId, actorId, def.id, created!.id, null, 'template_started');
  return created!;
}

async function loadAnswers(supabase: SB, progressId: string): Promise<AnswerMap> {
  const { data } = await supabase.from('impl_answers').select('question_key, value').eq('progress_id', progressId);
  const map: AnswerMap = {};
  for (const row of data ?? []) map[row.question_key] = row.value;
  return map;
}

async function priorStatuses(supabase: SB, progressId: string): Promise<Record<string, StepStatus>> {
  const { data } = await supabase.from('impl_step_progress').select('step_id, status').eq('progress_id', progressId);
  const map: Record<string, StepStatus> = {};
  for (const row of data ?? []) map[row.step_id] = row.status as StepStatus;
  return map;
}

export type LoadResult = EvaluatedTemplate & { answers: AnswerMap; milestonesToCelebrate: Milestone[]; progressId: string };

// The core: evaluate, persist step_progress + progress caches, fire milestones.
async function evaluateAndPersist(
  supabase: SB, accountId: string, actorId: string, def: TemplateDefinition,
  progress: { id: string; baseline?: BaselineMap | null },
): Promise<LoadResult> {
  const [answers, prior] = await Promise.all([
    loadAnswers(supabase, progress.id),
    priorStatuses(supabase, progress.id),
  ]);
  const resolverCtx: ResolverCtx = { accountId, supabase: supabase as never, params: null, answers };
  const baseline: BaselineMap = (progress.baseline as BaselineMap) ?? {};
  const evalResult = await evaluateTemplate(def, answers, prior, resolverCtx, undefined, baseline);

  // Persist step_progress (upsert on progress_id+step_id).
  const nowIso = new Date().toISOString();
  const rows = evalResult.steps.map((s) => ({
    account_id: accountId, progress_id: progress.id, step_id: s.step.id, status: s.status,
    auto: s.status === 'auto_completed',
    validation_snapshot: Object.fromEntries(s.ruleResults.map((r) => [r.source_key, r.value])),
    last_checked_at: nowIso,
    completed_at: (s.status === 'completed' || s.status === 'auto_completed') ? nowIso : null,
  }));
  if (rows.length) await supabase.from('impl_step_progress').upsert(rows, { onConflict: 'progress_id,step_id' });

  // Fire milestones whose trigger step is now completed/auto and not yet reached.
  const completedKeys = new Set(evalResult.steps.filter((s) => s.status === 'completed' || s.status === 'auto_completed').map((s) => s.step.step_key));
  const { data: reached } = await supabase.from('impl_milestone_progress').select('milestone_id').eq('progress_id', progress.id);
  const reachedIds = new Set((reached ?? []).map((r) => r.milestone_id));
  const newlyReached = def.milestones.filter((m) => completedKeys.has(m.trigger_step_key) && !reachedIds.has(m.id));
  if (newlyReached.length) {
    await supabase.from('impl_milestone_progress').insert(newlyReached.map((m) => ({
      account_id: accountId, progress_id: progress.id, milestone_id: m.id,
    })));
    for (const m of newlyReached) await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'milestone_reached', { milestone_key: m.milestone_key });
  }

  // Persist progress caches + completion.
  await supabase.from('impl_progress').update({
    progress_pct: evalResult.progressPct, score: evalResult.score, health_pct: evalResult.healthPct,
    current_step_id: evalResult.currentStepId, status: evalResult.completed ? 'completed' : 'in_progress',
    completed_at: evalResult.completed ? nowIso : null, updated_at: nowIso,
  }).eq('id', progress.id);
  if (evalResult.completed) await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'template_completed');

  // Milestones still awaiting acknowledgement (for the celebration card).
  const { data: toAck } = await supabase.from('impl_milestone_progress')
    .select('milestone_id').eq('progress_id', progress.id).eq('acknowledged', false);
  const ackIds = new Set((toAck ?? []).map((r) => r.milestone_id));
  const milestonesToCelebrate = def.milestones.filter((m) => ackIds.has(m.id));

  return { ...evalResult, answers, milestonesToCelebrate, progressId: progress.id };
}

// --- public actions ------------------------------------------------------
export async function loadGettingStarted(): Promise<LoadResult | { locked: true }> {
  const { supabase, actorId, accountId } = await ctx();
  const { data: acct } = await supabase.from('accounts').select('subscription_plan').eq('id', accountId).single();
  const def = await loadDefinition(supabase);
  if (!def || !templateLineAllowed(acct?.subscription_plan, def.product_line)) return { locked: true as const };
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  return evaluateAndPersist(supabase, accountId, actorId, def, progress);
}

export async function saveAnswer(questionKey: string, value: unknown): Promise<LoadResult> {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_answers').upsert({
    account_id: accountId, progress_id: progress.id, question_key: questionKey, value, answered_by: actorId,
    answered_at: new Date().toISOString(),
  }, { onConflict: 'progress_id,question_key' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'question_answered', { question_key: questionKey });
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}

export async function recheck(): Promise<LoadResult> {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}

async function setStepStatus(stepId: string, status: 'skipped' | 'completed', event: AnalyticsEventType): Promise<LoadResult> {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_step_progress').upsert({
    account_id: accountId, progress_id: progress.id, step_id: stepId, status,
    completed_by: actorId, completed_at: status === 'completed' ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,step_id' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, stepId, event);
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}
export async function skipStep(stepId: string): Promise<LoadResult> { return setStepStatus(stepId, 'skipped', 'step_skipped'); }
export async function markStepDone(stepId: string): Promise<LoadResult> { return setStepStatus(stepId, 'completed', 'step_completed'); }

export async function toggleTask(taskId: string, done: boolean): Promise<{ ok: true }> {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_task_progress').upsert({
    account_id: accountId, progress_id: progress.id, task_id: taskId, done,
    done_by: actorId, done_at: done ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,task_id' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'task_toggled', { task_id: taskId, done });
  revalidatePath(ROUTE);
  return { ok: true };
}

export async function requestHelp(stepId: string | null): Promise<{ supportUrl: string | null }> {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  const progress = def ? await getOrCreateProgress(supabase, accountId, def, actorId) : null;
  await logEvent(supabase, accountId, actorId, def?.id ?? null, progress?.id ?? null, stepId, 'help_requested');
  return { supportUrl: def?.support_whatsapp_url ?? null };
}

export async function acknowledgeMilestone(milestoneId: string): Promise<{ ok: true }> {
  const { supabase, accountId } = await ctx();
  await supabase.from('impl_milestone_progress').update({ acknowledged: true })
    .eq('account_id', accountId).eq('milestone_id', milestoneId);
  revalidatePath(ROUTE);
  return { ok: true };
}

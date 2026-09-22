'use server';

import { createClient } from '@/lib/supabase/server';
import { evaluateTemplate } from '@/lib/implementation/evaluate';
import { stepLineAllowed } from '@/lib/implementation/access';
import type {
  TemplateDefinition, TemplateStep, AnswerMap, StepStatus, EvaluatedTemplate,
  Milestone, AnalyticsEventType, BaselineMap,
} from '@/lib/implementation/types';
import { runResolver, type ResolverCtx } from '@/lib/implementation/resolvers';
import { isFounderEmail } from '@/lib/auth/founder';
import { serviceClient } from '@/lib/auth/superadmin';

const TEMPLATE_KEY = 'wfa_v1';

type SB = Awaited<ReturnType<typeof createClient>>;

// --- helpers -------------------------------------------------------------
async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile } = await supabase
    .from('profiles').select('id, account_id, account_role').eq('user_id', user.id).single();
  if (!profile?.account_id) throw new Error('No account');
  const { data: acct } = await supabase
    .from('accounts').select('subscription_plan').eq('id', profile.account_id).single();
  return {
    supabase, actorId: profile.id as string, accountId: profile.account_id as string,
    plan: (acct?.subscription_plan ?? null) as unknown,
  };
}

// Line-composed journey: keep only the steps/milestones this account's plan
// grants (plus shared 'core' and any not-yet-tagged NULL-line steps).
function filterByPlan(def: TemplateDefinition, plan: unknown): TemplateDefinition {
  return {
    ...def,
    steps: def.steps.filter((s) => stepLineAllowed(s.line, plan)),
    milestones: def.milestones.filter((m) => stepLineAllowed(m.line, plan)),
  };
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

// The template DEFINITION is global and static (only changes when we re-seed).
// Re-fetching its 8 tables on every button click was the main cause of slow
// actions — each is a separate cross-region round-trip. Cache it in-process.
let _defCache: { def: TemplateDefinition | null; at: number } | null = null;
const DEF_TTL_MS = 5 * 60 * 1000;

// Assemble the nested TemplateDefinition from its definition tables.
async function loadDefinition(supabase: SB): Promise<TemplateDefinition | null> {
  if (_defCache && Date.now() - _defCache.at < DEF_TTL_MS) return _defCache.def;
  const { data: tpl } = await supabase
    .from('impl_templates').select('*')
    .eq('template_key', TEMPLATE_KEY).eq('is_active', true)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (!tpl) { _defCache = { def: null, at: Date.now() }; return null; }
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
  const def = { ...tpl, steps: fullSteps, milestones: (milestones.data ?? []) as Milestone[] } as TemplateDefinition;
  _defCache = { def, at: Date.now() };
  return def;
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

  const nowIso = new Date().toISOString();
  const rows = evalResult.steps.map((s) => ({
    account_id: accountId, progress_id: progress.id, step_id: s.step.id, status: s.status,
    auto: s.status === 'auto_completed',
    validation_snapshot: Object.fromEntries(s.ruleResults.map((r) => [r.source_key, r.value])),
    last_checked_at: nowIso,
    completed_at: (s.status === 'completed' || s.status === 'auto_completed') ? nowIso : null,
  }));
  const completedKeys = new Set(evalResult.steps.filter((s) => s.status === 'completed' || s.status === 'auto_completed').map((s) => s.step.step_key));

  // Independent: persist step_progress AND read which milestones were already
  // reached — run together instead of one-after-another.
  const [, reachedRes] = await Promise.all([
    rows.length ? supabase.from('impl_step_progress').upsert(rows, { onConflict: 'progress_id,step_id' }) : Promise.resolve(),
    supabase.from('impl_milestone_progress').select('milestone_id').eq('progress_id', progress.id),
  ]);
  const reachedIds = new Set((reachedRes.data ?? []).map((r) => r.milestone_id));
  const newlyReached = def.milestones.filter((m) => completedKeys.has(m.trigger_step_key) && !reachedIds.has(m.id));
  if (newlyReached.length) {
    await Promise.all([
      supabase.from('impl_milestone_progress').insert(newlyReached.map((m) => ({
        account_id: accountId, progress_id: progress.id, milestone_id: m.id,
      }))),
      supabase.from('impl_analytics_events').insert(newlyReached.map((m) => ({
        account_id: accountId, actor_id: actorId, template_id: def.id, progress_id: progress.id,
        step_id: null, event_type: 'milestone_reached', metadata: { milestone_key: m.milestone_key },
      }))),
    ]);
  }

  // Independent: write progress caches AND read still-unacknowledged milestones.
  const [, toAckRes] = await Promise.all([
    supabase.from('impl_progress').update({
      progress_pct: evalResult.progressPct, score: evalResult.score, health_pct: evalResult.healthPct,
      current_step_id: evalResult.currentStepId, status: evalResult.completed ? 'completed' : 'in_progress',
      completed_at: evalResult.completed ? nowIso : null, updated_at: nowIso,
    }).eq('id', progress.id),
    supabase.from('impl_milestone_progress').select('milestone_id').eq('progress_id', progress.id).eq('acknowledged', false),
  ]);
  if (evalResult.completed) await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'template_completed');

  const ackIds = new Set((toAckRes.data ?? []).map((r) => r.milestone_id));
  const milestonesToCelebrate = def.milestones.filter((m) => ackIds.has(m.id));

  return { ...evalResult, answers, milestonesToCelebrate, progressId: progress.id };
}

// --- public actions ------------------------------------------------------
// FAST initial load: render from the LAST SAVED state (no live resolver queries,
// no writes) so opening Getting Started is instant. The client calls recheck()
// on mount to refresh against live data in the background. Reconstructs the
// evaluated view from each step's stored validation_snapshot.
export async function loadGettingStarted(): Promise<LoadResult | { locked: true }> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const def0 = await loadDefinition(supabase);
  if (!def0) return { locked: true as const };
  const def = filterByPlan(def0, plan);
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);

  const [answers, stepRows, ackRows] = await Promise.all([
    loadAnswers(supabase, progress.id),
    supabase.from('impl_step_progress').select('step_id, status, validation_snapshot').eq('progress_id', progress.id),
    supabase.from('impl_milestone_progress').select('milestone_id').eq('progress_id', progress.id).eq('acknowledged', false),
  ]);
  const prior: Record<string, StepStatus> = {};
  const snapshot: Record<string, number | boolean> = {};
  for (const r of stepRows.data ?? []) {
    prior[r.step_id] = r.status as StepStatus;
    Object.assign(snapshot, (r.validation_snapshot as Record<string, number | boolean>) ?? {});
  }
  const baseline: BaselineMap = (progress.baseline as BaselineMap) ?? {};
  const resolverCtx: ResolverCtx = { accountId, supabase: supabase as never, params: null, answers };
  // Resolver reads the saved snapshot instead of the DB — zero live queries.
  const cachedResolver = async (k: string) => (k in snapshot ? snapshot[k] : (0 as number | boolean));
  const evalResult = await evaluateTemplate(def, answers, prior, resolverCtx, cachedResolver, baseline);
  const ackIds = new Set((ackRows.data ?? []).map((r) => r.milestone_id));
  const milestonesToCelebrate = def.milestones.filter((m) => ackIds.has(m.id));
  return { ...evalResult, answers, milestonesToCelebrate, progressId: progress.id };
}

// Cheap "is onboarding finished?" check for chrome (the sidebar hides the
// "Getting Started" link once setup is complete). Reads only impl_progress.status
// — no template load, no evaluation — so it's a couple of quick round-trips and
// safe to call on every session load. Complete = a progress row exists AND every
// journey for the account is 'completed'.
export async function getImplementationComplete(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
  if (!profile?.account_id) return false;
  const { data } = await supabase
    .from('impl_progress').select('status').eq('account_id', profile.account_id);
  if (!data || data.length === 0) return false;
  return data.every((r) => r.status === 'completed');
}

export async function saveAnswer(questionKey: string, value: unknown): Promise<LoadResult> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const def0 = await loadDefinition(supabase);
  if (!def0) throw new Error('No template');
  const def = filterByPlan(def0, plan);
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_answers').upsert({
    account_id: accountId, progress_id: progress.id, question_key: questionKey, value, answered_by: actorId,
    answered_at: new Date().toISOString(),
  }, { onConflict: 'progress_id,question_key' });
  // Fire-and-forget analytics; don't make the user wait on it.
  void logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'question_answered', { question_key: questionKey });
  return evaluateAndPersist(supabase, accountId, actorId, def, progress);
}

export async function recheck(): Promise<LoadResult> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const def0 = await loadDefinition(supabase);
  if (!def0) throw new Error('No template');
  const def = filterByPlan(def0, plan);
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  return evaluateAndPersist(supabase, accountId, actorId, def, progress);
}

async function setStepStatus(stepId: string, status: 'skipped' | 'completed', event: AnalyticsEventType): Promise<LoadResult> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const def0 = await loadDefinition(supabase);
  if (!def0) throw new Error('No template');
  const def = filterByPlan(def0, plan);
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_step_progress').upsert({
    account_id: accountId, progress_id: progress.id, step_id: stepId, status,
    completed_by: actorId, completed_at: status === 'completed' ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,step_id' });
  void logEvent(supabase, accountId, actorId, def.id, progress.id, stepId, event);
  return evaluateAndPersist(supabase, accountId, actorId, def, progress);
}
export async function skipStep(stepId: string): Promise<LoadResult> { return setStepStatus(stepId, 'skipped', 'step_skipped'); }
export async function markStepDone(stepId: string): Promise<LoadResult> { return setStepStatus(stepId, 'completed', 'step_completed'); }

// A checklist tick is cosmetic — it must NOT reload the definition or re-run the
// whole evaluation engine (that was making the deep-link click feel slow). Just
// record it against the existing progress row and return immediately.
export async function toggleTask(taskId: string, done: boolean): Promise<{ ok: true }> {
  const { supabase, actorId, accountId } = await ctx();
  const { data: prog } = await supabase.from('impl_progress')
    .select('id, template_id').eq('account_id', accountId).eq('template_key', TEMPLATE_KEY).maybeSingle();
  if (!prog) return { ok: true };
  void supabase.from('impl_task_progress').upsert({
    account_id: accountId, progress_id: prog.id, task_id: taskId, done,
    done_by: actorId, done_at: done ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,task_id' }).then(() =>
    logEvent(supabase, accountId, actorId, prog.template_id, prog.id, null, 'task_toggled', { task_id: taskId, done }));
  return { ok: true };
}

export async function requestHelp(stepId: string | null): Promise<{ supportUrl: string | null }> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const def0 = await loadDefinition(supabase);
  const def = def0 ? filterByPlan(def0, plan) : null;
  const progress = def ? await getOrCreateProgress(supabase, accountId, def, actorId) : null;
  await logEvent(supabase, accountId, actorId, def?.id ?? null, progress?.id ?? null, stepId, 'help_requested');
  return { supportUrl: def?.support_whatsapp_url ?? null };
}

export async function acknowledgeMilestone(milestoneId: string): Promise<{ ok: true }> {
  const { supabase, accountId } = await ctx();
  await supabase.from('impl_milestone_progress').update({ acknowledged: true })
    .eq('account_id', accountId).eq('milestone_id', milestoneId);
  return { ok: true };
}

// ===================== TEMP-QA: remove before final release =====================
// Founder-only onboarding reset. Lets us re-walk Getting Started on the same
// account instead of creating a fresh signup for every change. Deletes ONLY this
// account's per-account progress rows (never the global template definition, never
// any other tenant), then re-enrolls with a fresh baseline. To remove: delete this
// block, the two imports it needs (isFounderEmail, serviceClient), and the QA
// button in page.tsx / GettingStartedClient.tsx.
// True only for the platform founder — gates the QA reset button's visibility.
export async function isFounderViewer(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return isFounderEmail(user?.email);
}

export async function resetGettingStarted(): Promise<LoadResult> {
  const { supabase, actorId, accountId, plan } = await ctx();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isFounderEmail(user?.email)) throw new Error('Founder only');

  const def0 = await loadDefinition(supabase);
  if (!def0) throw new Error('No template');
  const def = filterByPlan(def0, plan);

  // Service role, but scoped strictly to the caller's OWN account, so the wipe
  // can't be blocked by RLS and can't touch another tenant's data.
  const svc = serviceClient();
  const { data: prog } = await svc.from('impl_progress')
    .select('id').eq('account_id', accountId).eq('template_key', TEMPLATE_KEY).maybeSingle();
  if (prog) {
    // Children first (all keyed by progress_id), then the root row.
    for (const t of ['impl_task_progress', 'impl_step_progress', 'impl_milestone_progress', 'impl_answers', 'impl_analytics_events']) {
      await svc.from(t).delete().eq('progress_id', prog.id);
    }
    await svc.from('impl_progress').delete().eq('id', prog.id);
  }

  // Re-enroll fresh (new baseline snapshotted from current data) and return the
  // reset state so the client can render step 1 without a reload.
  const fresh = await getOrCreateProgress(supabase, accountId, def, actorId);
  return evaluateAndPersist(supabase, accountId, actorId, def, fresh);
}
// =================== END TEMP-QA ===================

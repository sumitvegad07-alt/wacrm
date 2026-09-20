'use client';
import { useState, useTransition, useEffect, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { PartyPopper, ArrowRight } from 'lucide-react';
import { saveAnswer, recheck, skipStep, markStepDone, toggleTask, requestHelp, acknowledgeMilestone, resetGettingStarted, type LoadResult } from './actions';
import { Hero } from '@/components/getting-started/Hero';
import { JourneyRail } from '@/components/getting-started/JourneyRail';
import { StepPanel } from '@/components/getting-started/StepPanel';
import { MilestoneCard } from '@/components/getting-started/MilestoneCard';

export default function GettingStartedClient({ initial, focus = false, isFounder = false }: { initial: LoadResult; focus?: boolean; isFounder?: boolean }) {
  const [state, setState] = useState<LoadResult>(initial);
  // Which step the user is viewing. Defaults to the current step; completed
  // steps can be reopened read-only, future steps stay locked.
  const [viewId, setViewId] = useState<string | null>(initial.currentStepId ?? initial.steps.find((s) => s.applicable)?.step.id ?? null);
  const [pending, startTransition] = useTransition();

  // The page renders instantly from the last saved state (fast load). Refresh
  // against live data once, quietly, on mount — no spinner, no toast.
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    (async () => {
      try {
        const res = await recheck();
        if (res && 'steps' in res) setState(res);
      } catch { /* keep the last-saved state on a transient error */ }
    })();
  }, []);

  const run = (fn: () => Promise<unknown>, msg?: string) =>
    startTransition(async () => {
      try {
        const res = (await fn()) as LoadResult | { ok: true } | { supportUrl: string | null };
        if (res && 'steps' in res) {
          setState(res);
          setViewId(res.currentStepId ?? viewId); // follow the flow forward as steps complete
        }
        if (msg) toast.success(msg);
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    });

  const applicable = state.steps.filter((s) => s.applicable);
  const viewed = state.steps.find((s) => s.step.id === viewId) ?? state.steps.find((s) => s.step.id === state.currentStepId) ?? applicable[0];
  const viewedIdx = applicable.findIndex((s) => s.step.id === viewed?.step.id);
  const celebrate = state.milestonesToCelebrate[0];

  return (
    <div className={focus ? 'min-h-screen bg-background' : ''}>
      {focus && (
        <div className="mb-4 flex items-center justify-between border-b px-4 py-3 md:px-6">
          <span className="text-sm font-semibold">OZZO · Setup</span>
          <Link href="/dashboard" className="text-sm text-muted-foreground underline">Skip to dashboard →</Link>
        </div>
      )}
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        {/* TEMP-QA: founder-only onboarding reset for re-testing without new signups. Remove before final release. */}
        {isFounder && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm('Reset your Getting Started progress? This clears steps/answers for THIS account only (no data is deleted) so you can re-walk onboarding.')) {
                  run(() => resetGettingStarted(), 'Onboarding reset');
                }
              }}
              className="rounded-md border border-dashed border-amber-500/60 px-2 py-1 text-xs font-medium text-amber-600 transition hover:bg-amber-500/10 disabled:opacity-50"
            >
              Reset onboarding (QA)
            </button>
          </div>
        )}
        <Hero state={state} onResume={() => setViewId(state.currentStepId)} onRecheck={() => run(recheck, 'Re-checked')} pending={pending} />

        {celebrate && <MilestoneCard milestone={celebrate} onDismiss={() => run(() => acknowledgeMilestone(celebrate.id))} />}

        {state.completed ? (
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-8 text-center">
            <PartyPopper className="mx-auto h-10 w-10 text-green-600" />
            <h2 className="mt-3 text-2xl font-semibold">You&rsquo;re all set up 🎉</h2>
            <p className="mt-1 text-muted-foreground">Your field force is live on OZZO. Nice work.</p>
            <Link href="/dashboard" className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110">
              Go to your dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            <JourneyRail steps={state.steps} currentId={state.currentStepId} selectedId={viewed?.step.id ?? null} onSelect={setViewId} />
            {viewed && (
              <StepPanel
                evaluated={viewed}
                answers={state.answers}
                pending={pending}
                spotlight={viewed.step.id === state.currentStepId}
                stepNumber={viewedIdx >= 0 ? viewedIdx + 1 : undefined}
                stepTotal={applicable.length}
                onAnswer={(k, v) => run(() => saveAnswer(k, v))}
                onSkip={() => run(() => skipStep(viewed.step.id), 'Step skipped')}
                onMarkDone={() => run(() => markStepDone(viewed.step.id), 'Marked done')}
                onToggleTask={(taskId, done) => run(() => toggleTask(taskId, done))}
                onHelp={async () => { const r = await requestHelp(viewed.step.id); if (r.supportUrl) window.open(r.supportUrl, '_blank'); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
import { useState, useTransition, useEffect, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { PartyPopper, ArrowRight } from 'lucide-react';
import { saveAnswer, recheck, skipStep, markStepDone, toggleTask, requestHelp, acknowledgeMilestone, type LoadResult } from './actions';
import { Hero } from '@/components/getting-started/Hero';
import { JourneyRail } from '@/components/getting-started/JourneyRail';
import { StepPanel } from '@/components/getting-started/StepPanel';
import { MilestoneCard } from '@/components/getting-started/MilestoneCard';

export default function GettingStartedClient({ initial, focus = false }: { initial: LoadResult; focus?: boolean }) {
  const [state, setState] = useState<LoadResult>(initial);
  // Which step the user is viewing. Defaults to the current step; completed
  // steps can be reopened read-only, future steps stay locked.
  const [viewId, setViewId] = useState<string | null>(initial.currentStepId ?? initial.steps.find((s) => s.applicable)?.step.id ?? null);
  const [, startTransition] = useTransition();

  // Perceived-responsiveness fixes (founder feedback: buttons felt dead / actions
  // applied out of order). Server actions cross the region to Singapore (~1s), so
  // instead of only trimming that we make every click FEEL instant:
  //   1. `busy` names the exact control in flight → that button shows a spinner and
  //      the panel greys out, so a click is never ambiguous ("did it register?").
  //   2. `optimisticAnswer` rings the chosen option immediately, before the server
  //      answers, so picking an option is instant.
  //   3. `seq` is a monotonic request counter: only the LATEST action's result is
  //      applied. A slower earlier response can no longer overwrite a newer click —
  //      this is what made it feel like "the previous button's action ran".
  const [busy, setBusy] = useState<string | null>(null);
  const [optimisticAnswer, setOptimisticAnswer] = useState<{ k: string; v: unknown } | null>(null);
  const seq = useRef(0);

  // Funnel for every server action. `busyKey` drives the per-button spinner;
  // `silent` skips the busy indicator (used for the quiet on-mount refresh).
  const run = (
    fn: () => Promise<unknown>,
    opts: { msg?: string; busyKey?: string; silent?: boolean } = {},
  ) => {
    const my = ++seq.current;
    if (!opts.silent) setBusy(opts.busyKey ?? 'busy');
    startTransition(async () => {
      try {
        const res = (await fn()) as LoadResult | { ok: true } | { supportUrl: string | null };
        if (my !== seq.current) return; // superseded by a newer action — ignore this stale result
        if (res && 'steps' in res) {
          setState(res);
          setViewId(res.currentStepId ?? viewId); // follow the flow forward as steps complete
        }
        setOptimisticAnswer(null);
        if (opts.msg) toast.success(opts.msg);
      } catch (e) {
        if (my === seq.current) toast.error(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        if (my === seq.current) setBusy(null);
      }
    });
  };

  // The page renders instantly from the last saved state (fast load). Refresh
  // against live data once, quietly, on mount — no spinner, no toast — but through
  // the same sequence guard so a click made during the refresh always wins.
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    run(() => recheck(), { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Merge the optimistic pick over the saved answers so the selected option rings
  // the instant it's clicked, then reconciles when the server result lands.
  const answers = optimisticAnswer ? { ...state.answers, [optimisticAnswer.k]: optimisticAnswer.v } : state.answers;

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
        <Hero
          state={state}
          onResume={() => setViewId(state.currentStepId)}
          onRecheck={() => run(() => recheck(), { msg: 'Re-checked', busyKey: 'recheck' })}
          busy={busy}
          // "Resume" only makes sense when you've wandered off your current step —
          // then it jumps you back. Hidden when you're already there.
          canResume={viewed?.step.id !== state.currentStepId && state.currentStepId != null}
        />

        {celebrate && <MilestoneCard milestone={celebrate} onDismiss={() => run(() => acknowledgeMilestone(celebrate.id), { busyKey: 'ack' })} />}

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
                answers={answers}
                busy={busy}
                spotlight={viewed.step.id === state.currentStepId}
                stepNumber={viewedIdx >= 0 ? viewedIdx + 1 : undefined}
                stepTotal={applicable.length}
                supportUrl={state.template.support_whatsapp_url}
                onAnswer={(k, v) => { setOptimisticAnswer({ k, v }); run(() => saveAnswer(k, v), { busyKey: `answer:${k}:${String(v)}` }); }}
                onSkip={() => run(() => skipStep(viewed.step.id), { msg: 'Step skipped', busyKey: 'skip' })}
                onMarkDone={() => run(() => markStepDone(viewed.step.id), { msg: 'Marked done', busyKey: 'markDone' })}
                onToggleTask={(taskId, done) => run(() => toggleTask(taskId, done), { silent: true })}
                onHelp={async () => { const r = await requestHelp(viewed.step.id); if (r.supportUrl) window.open(r.supportUrl, '_blank'); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

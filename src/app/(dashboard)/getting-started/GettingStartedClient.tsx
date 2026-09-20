'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveAnswer, recheck, skipStep, markStepDone, toggleTask, requestHelp, acknowledgeMilestone, type LoadResult } from './actions';
import { Hero } from '@/components/getting-started/Hero';
import { JourneyRail } from '@/components/getting-started/JourneyRail';
import { StepPanel } from '@/components/getting-started/StepPanel';
import { MilestoneCard } from '@/components/getting-started/MilestoneCard';

export default function GettingStartedClient({ initial }: { initial: LoadResult }) {
  const [state, setState] = useState<LoadResult>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.currentStepId ?? initial.steps[0]?.step.id ?? null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>, msg?: string) =>
    startTransition(async () => {
      try {
        const res = (await fn()) as LoadResult | { ok: true } | { supportUrl: string | null };
        if (res && 'steps' in res) setState(res);
        if (msg) toast.success(msg);
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    });

  const selected = state.steps.find((s) => s.step.id === selectedId) ?? state.steps.find((s) => s.step.id === state.currentStepId);
  const celebrate = state.milestonesToCelebrate[0];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <Hero state={state} onResume={() => setSelectedId(state.currentStepId)} onRecheck={() => run(recheck, 'Re-checked')} pending={pending} />
      {celebrate && (
        <MilestoneCard milestone={celebrate} onDismiss={() => run(() => acknowledgeMilestone(celebrate.id))} />
      )}
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <JourneyRail steps={state.steps} selectedId={selected?.step.id ?? null} onSelect={setSelectedId} />
        {selected && (
          <StepPanel
            evaluated={selected}
            answers={state.answers}
            pending={pending}
            onAnswer={(k, v) => run(() => saveAnswer(k, v))}
            onSkip={() => run(() => skipStep(selected.step.id), 'Step skipped')}
            onMarkDone={() => run(() => markStepDone(selected.step.id), 'Marked done')}
            onToggleTask={(taskId, done) => run(() => toggleTask(taskId, done))}
            onHelp={async () => { const r = await requestHelp(selected.step.id); if (r.supportUrl) window.open(r.supportUrl, '_blank'); }}
          />
        )}
      </div>
    </div>
  );
}

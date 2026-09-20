'use client';
import type { EvaluatedStep, AnswerMap } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';
import { Play, MessageCircle } from 'lucide-react';
import { ContentTabs } from './ContentTabs';
import { STEP_TOURS } from '@/lib/tour/scripts';
import { launchTour } from '@/lib/tour/launch';

// Customer-facing labels for validation metrics — never show raw source_keys.
const VALIDATION_LABELS: Record<string, string> = {
  territory_count: 'Territories', customer_count: 'Customers', role_count: 'Roles',
  employee_count: 'Employees', employee_logged_in: 'Team member logged in',
  attendance_or_visit: 'First activity recorded', meaningful_data: 'Live data flowing',
};

export function StepPanel({ evaluated, answers, pending, spotlight = false, stepNumber, stepTotal, supportUrl, onAnswer, onSkip, onMarkDone, onToggleTask, onHelp }: {
  evaluated: EvaluatedStep; answers: AnswerMap; pending: boolean;
  spotlight?: boolean; stepNumber?: number; stepTotal?: number; supportUrl?: string | null;
  onAnswer: (k: string, v: unknown) => void; onSkip: () => void; onMarkDone: () => void;
  onToggleTask: (taskId: string, done: boolean) => void; onHelp: () => void;
}) {
  const { step, status, ruleResults } = evaluated;
  const done = status === 'completed' || status === 'auto_completed';
  // If this step has a guided tour, it takes over the primary CTA — a real
  // step-by-step walkthrough on the actual pages instead of a plain deep-link.
  const tourId = STEP_TOURS[step.step_key];
  // In the guided flow the first deep-linked task becomes the big "do this now" CTA.
  const primaryTask = spotlight && !tourId ? step.tasks.find((t) => t.deep_link) : undefined;
  const otherTasks = step.tasks.filter((t) => t.id !== primaryTask?.id);
  const deepLink = (link: string) => `${link}?from=getting-started&step=${step.step_key}`;
  return (
    <div className="space-y-4">
      <div>
        {stepNumber && stepTotal && (
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Step {stepNumber} of {stepTotal}</p>
        )}
        <h2 className="text-xl font-semibold">{step.title}</h2>
        {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
      </div>
      <ContentTabs step={step} />

      {/* Steps with no guided tour and no in-app deep-link (e.g. the mobile-only
          steps — mobile login, first activity) can't spotlight a web button, so
          surface their how-to steps prominently here instead of hiding them. */}
      {!tourId && !primaryTask && step.questions.length === 0 && step.tasks.every((t) => !t.deep_link) && step.quick_steps.length > 0 && !done && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold">How to complete this step</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {step.quick_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {step.help_text && <p className="mt-2 text-xs text-muted-foreground">{step.help_text}</p>}
        </div>
      )}

      {spotlight && tourId && !done && (
        <button type="button" onClick={() => launchTour(tourId, step.id)}
          className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
          <span className="absolute inset-0 animate-pulse rounded-xl ring-2 ring-primary/40" aria-hidden />
          Start guided setup →
        </button>
      )}

      {primaryTask?.deep_link && !done && (
        <a href={deepLink(primaryTask.deep_link)} onClick={() => onToggleTask(primaryTask.id, true)}
          className="group relative flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:brightness-110">
          <span className="absolute inset-0 animate-pulse rounded-xl ring-2 ring-primary/40" aria-hidden />
          {primaryTask.label} →
        </a>
      )}

      {step.questions.map((q) => (
        <div key={q.id} className="rounded-xl border p-4">
          <p className="text-sm font-medium">{q.label}</p>
          <div className="mt-2 grid gap-2">
            {q.options.map((o) => {
              const selected = answers[q.question_key] === o.value;
              return (
                <button key={o.value} onClick={() => onAnswer(q.question_key, o.value)}
                  className={`rounded-lg border p-3 text-left text-sm ${selected ? 'ring-2 ring-primary' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span>{o.label}</span>
                    {o.recommended_badge && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{o.recommended_badge}</span>}
                  </div>
                  {o.note && <p className="mt-1 text-xs text-muted-foreground">{o.note}</p>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {otherTasks.length > 0 && (
        <ul className="space-y-2">
          {otherTasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">{t.label}{t.optional ? ' (optional)' : ''}</span>
              {t.deep_link && (
                <a className="text-sm font-medium text-primary underline"
                  href={deepLink(t.deep_link)}
                  onClick={() => onToggleTask(t.id, true)}>Go →</a>
              )}
            </li>
          ))}
        </ul>
      )}

      {ruleResults.some((r) => r.source_key !== 'answer') && (
        <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
          {ruleResults.filter((r) => r.source_key !== 'answer').map((r) => {
            const label = VALIDATION_LABELS[r.source_key] ?? r.source_key;
            const isCount = typeof r.value === 'number';
            return (
              <div key={r.source_key} className={r.requiredPass ? 'text-green-600' : 'text-muted-foreground'}>
                {r.requiredPass ? '✓' : '○'} {label}{isCount ? `: ${r.value}` : r.requiredPass ? '' : ' — not yet'}
                {r.recommendedThreshold != null && ` · recommended ${r.recommendedThreshold}${r.recommendedPass ? ' ✓' : ' ⚠️'}`}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {done && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">✓ Done</span>}
        {!done && <Button variant="secondary" onClick={onMarkDone} disabled={pending}>Mark as done</Button>}
        {!done && step.is_optional && <Button variant="ghost" onClick={onSkip} disabled={pending}>Skip for now</Button>}

        {/* Watch Video — opens this step's YouTube link. Placeholder (disabled) until a URL is set on the step. */}
        {step.video_url ? (
          <Button variant="outline" onClick={() => window.open(step.video_url!, '_blank', 'noopener,noreferrer')}>
            <Play className="h-4 w-4" /> Watch Video
          </Button>
        ) : (
          <Button variant="outline" disabled title="Video coming soon">
            <Play className="h-4 w-4" /> Watch Video
          </Button>
        )}

        {/* WhatsApp support — opens the template's support number. Placeholder (disabled) until it's set. */}
        {supportUrl ? (
          <Button variant="outline" onClick={onHelp}>
            <MessageCircle className="h-4 w-4" /> WhatsApp support
          </Button>
        ) : (
          <Button variant="outline" disabled title="Support link coming soon">
            <MessageCircle className="h-4 w-4" /> WhatsApp support
          </Button>
        )}
      </div>
    </div>
  );
}

'use client';
import type { EvaluatedStep, AnswerMap } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';
import { ContentTabs } from './ContentTabs';

export function StepPanel({ evaluated, answers, pending, onAnswer, onSkip, onMarkDone, onToggleTask, onHelp }: {
  evaluated: EvaluatedStep; answers: AnswerMap; pending: boolean;
  onAnswer: (k: string, v: unknown) => void; onSkip: () => void; onMarkDone: () => void;
  onToggleTask: (taskId: string, done: boolean) => void; onHelp: () => void;
}) {
  const { step, status, ruleResults } = evaluated;
  const done = status === 'completed' || status === 'auto_completed';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{step.title}</h2>
        {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
      </div>
      <ContentTabs step={step} />

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

      {step.tasks.length > 0 && (
        <ul className="space-y-2">
          {step.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">{t.label}</span>
              {t.deep_link && (
                <a className="text-sm font-medium text-primary underline"
                  href={`${t.deep_link}?from=getting-started&step=${step.step_key}`}
                  onClick={() => onToggleTask(t.id, true)}>Go →</a>
              )}
            </li>
          ))}
        </ul>
      )}

      {ruleResults.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          {ruleResults.map((r) => (
            <div key={r.source_key} className={r.requiredPass ? 'text-green-600' : 'text-muted-foreground'}>
              {r.source_key}: {String(r.value)} {r.requiredPass ? '✓' : ''}
              {r.recommendedThreshold != null && ` · recommended ${r.recommendedThreshold}${r.recommendedPass ? ' ✓' : ' ⚠️'}`}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!done && !step.auto_complete && <Button onClick={onMarkDone} disabled={pending}>Mark done</Button>}
        {!done && step.is_optional && <Button variant="ghost" onClick={onSkip} disabled={pending}>Skip</Button>}
        <Button variant="outline" onClick={onHelp}>Need help?</Button>
      </div>
    </div>
  );
}

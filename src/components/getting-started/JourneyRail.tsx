'use client';
import type { EvaluatedStep } from '@/lib/implementation/types';
import { cn } from '@/lib/utils';
import { Check, Lock } from 'lucide-react';

const DONE = new Set(['completed', 'auto_completed']);

// One-at-a-time roadmap: completed steps and the current step are clickable;
// everything after the current step is locked (revealed one at a time).
export function JourneyRail({ steps, currentId, selectedId, onSelect }: {
  steps: EvaluatedStep[]; currentId: string | null; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const applicable = steps.filter((s) => s.applicable);
  const currentIdx = applicable.findIndex((s) => s.step.id === currentId);
  return (
    <nav className="space-y-2">
      {applicable.map((s, i) => {
        const isDone = DONE.has(s.status) || s.status === 'skipped';
        const isCurrent = s.step.id === currentId;
        // Locked = comes after the current step (and isn't already done).
        const locked = !isDone && !isCurrent && currentIdx !== -1 && i > currentIdx;
        const clickable = !locked;
        return (
          <button key={s.step.id} disabled={!clickable} onClick={() => clickable && onSelect(s.step.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
              clickable ? 'hover:bg-muted/50' : 'cursor-not-allowed opacity-50',
              selectedId === s.step.id && 'ring-2 ring-primary',
              isCurrent && 'border-primary/50 bg-primary/5',
            )}>
            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs',
              isDone ? 'bg-green-100 text-green-700' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              {isDone ? <Check className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3 w-3" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm', isCurrent ? 'font-semibold' : 'font-medium')}>{s.step.title}</span>
              {s.step.estimated_minutes > 0 && !isDone && <span className="text-xs text-muted-foreground">~{s.step.estimated_minutes} min</span>}
              {s.status === 'skipped' && <span className="text-xs text-muted-foreground">Skipped</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

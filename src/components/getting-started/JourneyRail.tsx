'use client';
import type { EvaluatedStep } from '@/lib/implementation/types';
import { cn } from '@/lib/utils';

const PILL: Record<string, string> = {
  completed: 'bg-green-100 text-green-700', auto_completed: 'bg-green-100 text-green-700',
  skipped: 'bg-muted text-muted-foreground', available: 'bg-primary/10 text-primary',
  in_progress: 'bg-primary/10 text-primary', locked: 'bg-muted text-muted-foreground',
};
const LABEL: Record<string, string> = {
  completed: 'Done', auto_completed: 'Done', skipped: 'Skipped', available: 'To do', in_progress: 'In progress', locked: 'Locked',
};

export function JourneyRail({ steps, selectedId, onSelect }: {
  steps: EvaluatedStep[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <nav className="space-y-2">
      {steps.filter((s) => s.applicable).map((s, i) => (
        <button key={s.step.id} onClick={() => onSelect(s.step.id)}
          className={cn('w-full rounded-xl border p-3 text-left transition', selectedId === s.step.id && 'ring-2 ring-primary')}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{i + 1}. {s.step.title}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs', PILL[s.status])}>{LABEL[s.status]}</span>
          </div>
          {s.step.estimated_minutes > 0 && <span className="text-xs text-muted-foreground">~{s.step.estimated_minutes} min</span>}
        </button>
      ))}
    </nav>
  );
}

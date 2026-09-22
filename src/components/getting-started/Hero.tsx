'use client';
import type { EvaluatedTemplate } from '@/lib/implementation/types';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HealthPanel } from './HealthPanel';

function Ring({ pct }: { pct: number }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 44 44)" className="text-primary transition-all" />
      <text x="44" y="49" textAnchor="middle" className="fill-foreground text-lg font-semibold">{pct}%</text>
    </svg>
  );
}

export function Hero({ state, onResume, onRecheck, busy }: {
  state: EvaluatedTemplate; onResume: () => void; onRecheck: () => void; busy: string | null;
}) {
  const working = busy !== null;
  const remaining = state.steps
    .filter((s) => s.applicable && s.status !== 'completed' && s.status !== 'auto_completed' && s.status !== 'skipped')
    .reduce((a, s) => a + s.step.estimated_minutes, 0);
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-6">
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <Ring pct={state.progressPct} />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{state.template.display_name}</h1>
          <p className="text-sm text-muted-foreground">{state.template.description}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span>Score: <b>{state.score}%</b></span>
            <span>Health: <b>{state.healthPct}%</b></span>
            {remaining > 0 && <span>~{remaining} min left</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!state.completed && <Button onClick={onResume} disabled={working}>Resume</Button>}
          <Button variant="outline" onClick={onRecheck} disabled={working}>
            {busy === 'recheck' && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy === 'recheck' ? 'Checking…' : 'Re-check'}
          </Button>
        </div>
      </div>
      <HealthPanel steps={state.steps} />
    </div>
  );
}

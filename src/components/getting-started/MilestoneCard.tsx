'use client';
import type { Milestone } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';

export function MilestoneCard({ milestone, onDismiss }: { milestone: Milestone; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <p className="font-semibold">🎉 {milestone.title}</p>
        {milestone.message && <p className="text-sm text-muted-foreground">{milestone.message}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}

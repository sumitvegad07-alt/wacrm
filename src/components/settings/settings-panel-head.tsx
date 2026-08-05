import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Section header shown at the top of every settings panel — a title,
 * a one-line description, and an optional right-aligned action (e.g.
 * "New template", "Invite member"). Mirrors the mockup's `.panel-head`.
 */
export function SettingsPanelHead({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  if (!action) return null;

  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-end', className)}>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

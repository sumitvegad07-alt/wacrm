'use client';

import Link from 'next/link';
import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { QuotationVersion } from '@/lib/quotation-versions';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Sent: 'bg-blue-600 text-white shadow-sm border-transparent',
  Approved: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
};

/**
 * Every version of the quotation being viewed, newest first.
 *
 * Renders nothing for a quotation that was never versioned — a panel saying
 * "this has one version" is noise on the great majority of quotations.
 *
 * Newest first because that is what an admin is usually checking against: what
 * did we send last, and what did it say before that. The version number, not
 * the position in the list, is what identifies a row.
 */
export function QuotationVersionsPanel({
  versions,
  currentId,
}: {
  versions: QuotationVersion[];
  currentId: string;
}) {
  if (versions.length < 2) return null;

  const newestFirst = [...versions].sort((a, b) => b.version - a.version);

  return (
    <div className="bg-card border-border rounded-lg border p-6">
      <h3 className="border-border mb-4 flex items-center gap-2 border-b pb-4 text-lg font-medium">
        <History className="text-muted-foreground size-5" />
        Versions
        <span className="text-muted-foreground text-sm font-normal">
          ({versions.length})
        </span>
      </h3>

      <ul className="space-y-2">
        {newestFirst.map((v) => {
          const isCurrent = v.id === currentId;
          const row = (
            <div
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                isCurrent
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  variant="secondary"
                  className="shrink-0 px-2 py-0.5 text-xs font-normal"
                >
                  v{v.version}
                </Badge>
                <span className="truncate font-medium">{v.quotation_number}</span>
                {isCurrent && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    viewing
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-muted-foreground text-xs">
                  {v.date ? new Date(v.date).toLocaleDateString() : '-'}
                </span>
                <Badge
                  variant="outline"
                  className={`px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.status] || ''}`}
                >
                  {v.status}
                </Badge>
              </div>
            </div>
          );

          return (
            <li key={v.id}>
              {isCurrent ? row : <Link href={`/quotations/${v.id}`}>{row}</Link>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

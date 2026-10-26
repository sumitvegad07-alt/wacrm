'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatCell, readListPayload, type ListPrintPayload } from '@/lib/print/list-payload';
import { paperMetrics, parsePaperSize } from '@/lib/print/paper';

/**
 * Print view for whatever list is on screen.
 *
 * The rows are handed over through localStorage by the table that opened
 * this tab — see lib/print/list-payload. It deliberately does NOT re-run the
 * query: the screen's filters, column choices and sort are the user's, and a
 * print that quietly showed a different set of rows than the one they are
 * looking at would be worse than no print at all.
 *
 * One consequence worth knowing: the link is good for about an hour, and
 * only in the browser that made it. Reopening it tomorrow finds nothing, and
 * says so rather than printing an empty table that looks like a real result.
 */
function ListPrintInner() {
  const params = useSearchParams();
  const { size, compact, margin, title, body, table } = paperMetrics(
    parsePaperSize(params.get('size')),
  );

  const [payload, setPayload] = useState<ListPrintPayload | null>(null);
  const [ready, setReady] = useState(false);

  // localStorage is not available during server rendering, so the read
  // happens after mount. `ready` keeps the expired message from flashing up
  // before the data has been looked for.
  useEffect(() => {
    setPayload(readListPayload(params.get('key') || ''));
    setReady(true);
  }, [params]);

  if (!ready) return null;

  if (!payload) {
    return (
      <div className="min-h-screen bg-white p-10 text-center text-gray-600">
        <p className="text-lg font-semibold text-gray-900">This print link has expired.</p>
        <p className="mt-2 text-sm">
          Print links last about an hour. Go back to the list and choose Print again.
        </p>
      </div>
    );
  }

  const printedAt = new Date(payload.printedAt).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-white text-black">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @page { size: ${size} portrait; margin: ${margin}; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hide { display: none !important; }
          /* Repeat the headings on every sheet — page four of a long list is
             unreadable without them. */
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
        .sheet { padding: ${compact ? '6mm' : '10mm'}; }
        .ttl { font-size: ${title}; font-weight: 800; color: #111827; }
        .meta { font-size: ${body}; color: #6b7280; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: ${table}; margin-top: ${compact ? '8px' : '14px'}; }
        th { text-align: left; background: #f3f4f6; color: #111827; font-weight: 700;
             border-bottom: 1.5px solid #9ca3af; padding: ${compact ? '3px 4px' : '6px 8px'}; }
        td { border-bottom: 1px solid #e5e7eb; padding: ${compact ? '3px 4px' : '5px 8px'};
             color: #111827; vertical-align: top; }
        tr:nth-child(even) td { background: #fafafa; }
        .foot { margin-top: ${compact ? '10px' : '16px'}; font-size: ${body}; color: #9ca3af; }
        .warn { margin-top: 6px; font-size: ${body}; color: #b45309; font-weight: 600; }
      `,
        }}
      />

      <div className="print-hide fixed right-4 top-4 z-10">
        <button
          onClick={() => window.print()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-blue-700"
        >
          Print
        </button>
      </div>

      <div className="sheet">
        <div className="ttl">{payload.title}</div>
        <div className="meta">
          {payload.total.toLocaleString('en-IN')} record{payload.total === 1 ? '' : 's'} · printed{' '}
          {printedAt}
        </div>
        {payload.truncated && (
          <div className="warn">
            Showing the first {payload.rows.length.toLocaleString('en-IN')} rows only. Narrow the
            filter on the list to print the rest.
          </div>
        )}

        <table>
          <thead>
            <tr>
              {payload.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, i) => (
              <tr key={i}>
                {payload.columns.map((c) => (
                  <td key={c.key}>{formatCell(row[c.key], c.type)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {payload.rows.length === 0 && (
          <div className="foot">The list had no rows matching the current filters.</div>
        )}
      </div>
    </div>
  );
}

export default function ListPrintPage() {
  // useSearchParams needs a Suspense boundary or the build refuses to
  // prerender this route.
  return (
    <Suspense fallback={null}>
      <ListPrintInner />
    </Suspense>
  );
}

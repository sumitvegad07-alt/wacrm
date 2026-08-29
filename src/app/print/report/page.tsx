'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { executeReport } from '@/app/actions/reports';
import { getReportByModule } from '@/lib/reports/registry';
import type { ReportMeasure } from '@/lib/reports/types';

/**
 * Print / PDF view for a report. Reads the report parameters from the query string
 * (module, dimensions, measures, filters, period label, tab label) and re-runs the
 * report through the same execute_report RPC — so it is scoped to the signed-in user
 * exactly like the on-screen report. This is the canonical report template; the
 * mobile app renders a matching layout locally from its already-scoped rows.
 *
 *   /print/report?module=sales&dims=customer&measures=order_count,net_amount
 *                &filters=<base64 json>&period=This%20Month&tab=Customer
 */
type Row = Record<string, string | number | null>;

function ReportPrintInner() {
  const params = useSearchParams();
  const supabase = createClient();

  const moduleName = params.get('module') || '';
  const dims = (params.get('dims') || '').split(',').filter(Boolean);
  const measures = (params.get('measures') || '').split(',').filter(Boolean);
  const periodLabel = params.get('period') || '';
  const tabLabel = params.get('tab') || '';
  let filters: Record<string, unknown> = {};
  try { filters = params.get('filters') ? JSON.parse(atob(params.get('filters')!)) : {}; } catch { filters = {}; }

  const def = getReportByModule(moduleName);

  const [rows, setRows] = useState<Row[]>([]);
  const [accountName, setAccountName] = useState('Report');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!def) { setError('Unknown report'); setLoading(false); return; }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: prof } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).limit(1).maybeSingle();
          if (prof?.account_id) {
            const { data: acct } = await supabase.from('accounts').select('name').eq('id', prof.account_id).maybeSingle();
            if (acct?.name) setAccountName(acct.name);
          }
        }
        const data = await executeReport(moduleName, dims, measures, filters, undefined, 'asc', 5000, 0);
        setRows((data as Row[]) || []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to run report');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !error) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [loading, error]);

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !def) return <div className="p-10 text-center text-red-600">{error || 'Unknown report'}</div>;

  const measureDef = (k: string): ReportMeasure | undefined => def.measures.find((m) => m.key === k);
  const dimLabel = (k: string) => def.dimensions.find((d) => d.key === k)?.label ?? k;
  const fmt = (k: string, v: Row[string]): string => {
    const m = measureDef(k);
    if (v == null || v === '') return m ? (m.type === 'currency' ? '₹0' : '0') : '—';
    if (!m) return String(v);
    const n = Number(v);
    if (m.type === 'currency') return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    if (m.type === 'percent') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  const kpis = def.kpis.map((k) => {
    const m = measureDef(k);
    const additive = m && m.type !== 'percent' && m.additive !== false;
    const total = additive ? rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) : null;
    return { label: m?.label ?? k, value: total == null ? '—' : fmt(k, total) };
  });

  const activeFilterLabels = Object.keys(filters)
    .filter((k) => k !== 'date_range')
    .map((k) => def.filters.find((f) => f.key === k)?.label ?? k);

  return (
    <div className="report-print">
      <style>{`
        @page { margin: 16mm; }
        .report-print { font-family: -apple-system, Roboto, Arial, sans-serif; color: #1f2937; padding: 20px; }
        .head { border-bottom: 3px solid #6366F1; padding-bottom: 14px; margin-bottom: 18px; }
        .acct { font-size: 22px; font-weight: 800; color: #111827; }
        .rpt { font-size: 15px; color: #6366F1; font-weight: 700; margin-top: 2px; }
        .meta { font-size: 11px; color: #6b7280; margin-top: 6px; }
        .filters span { display:inline-block; background:#eef2ff; color:#4338ca; font-size:10px; padding:3px 8px; border-radius:10px; margin:8px 6px 0 0; }
        .kpis { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 20px; }
        .kpi { border:1px solid #e5e7eb; border-radius:10px; padding:12px 16px; min-width:130px; }
        .kpi-v { font-size:18px; font-weight:800; color:#111827; }
        .kpi-l { font-size:10px; color:#6b7280; text-transform:uppercase; letter-spacing:.4px; margin-top:3px; }
        table { width:100%; border-collapse:collapse; font-size:11px; }
        th { text-align:left; background:#f9fafb; color:#374151; font-weight:800; padding:8px 10px; border-bottom:2px solid #e5e7eb; }
        td { padding:7px 10px; border-bottom:1px solid #f1f1f4; }
        th.num, td.num { text-align:right; }
        tr:nth-child(even) td { background:#fcfcfd; }
        .foot { margin-top:18px; font-size:10px; color:#9ca3af; }
        @media print { .noprint { display:none; } }
      `}</style>

      <div className="head">
        <div className="acct">{accountName}</div>
        <div className="rpt">{def.label}{tabLabel ? ` — ${tabLabel}` : ''}</div>
        <div className="meta">Period: {periodLabel || '—'} · Generated {new Date().toLocaleString('en-IN')}</div>
        {activeFilterLabels.length > 0 && (
          <div className="filters">{activeFilterLabels.map((l) => <span key={l}>{l}</span>)}</div>
        )}
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}><div className="kpi-v">{k.value}</div><div className="kpi-l">{k.label}</div></div>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            {dims.map((d) => <th key={d}>{dimLabel(d)}</th>)}
            {measures.map((m) => <th key={m} className="num">{measureDef(m)?.label ?? m}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {dims.map((d) => <td key={d}>{r[d] != null && r[d] !== '' ? String(r[d]) : '—'}</td>)}
              {measures.map((m) => <td key={m} className="num">{fmt(m, r[m])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="foot">{rows.length} row(s).</div>
    </div>
  );
}

// This view reads query params (useSearchParams) and runs the report at request
// time, so it must not be statically prerendered — Suspense + force-dynamic.
export const dynamic = 'force-dynamic';

export default function ReportPrintView() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <ReportPrintInner />
    </Suspense>
  );
}

'use server';

import { createClient } from '@/lib/supabase/server';
import type { ReportConfig } from '@/lib/reports/types';
import { getReportByModule } from '@/lib/reports/registry';
import {
  resolveSavedView,
  moduleForTab,
  type ReportQuery,
  type ViewFallback,
} from '@/lib/reports/open-view';

/**
 * Everything opening a report needs, in one round trip.
 *
 * It used to take two, in sequence: `getDefaultReportView`, then — once the
 * browser had made sense of the answer — `executeReport`. Each is a separate
 * POST to a Vercel function, each re-authenticating with a network call to
 * Supabase Auth and re-reading the caller's account, and a function here
 * measures 300-600 ms warm and about 1.4 s cold. That second trip was most of
 * the spinner the founder was complaining about; the database was never in the
 * frame at 140-230 ms.
 *
 * So the layout is resolved here instead, with the same pure function the
 * viewer uses, and the first page of rows comes back in the same response.
 *
 * `rows` is a best effort. A saved view can reference something the report
 * engine will not accept any more, and a report that fails to open is far worse
 * than one that opens a beat slower — so a failed query returns null rows and
 * the viewer simply asks for them the ordinary way. `ran` says exactly which
 * query produced the rows, so the viewer can check they are the rows it wants
 * before using them rather than trusting that both sides reasoned alike.
 */
export async function openReport(
  moduleName: string,
  fallback: ViewFallback & {
    filters?: Record<string, unknown>;
    sortColumn?: string | null;
    sortDirection?: 'asc' | 'desc';
    limit: number;
  },
): Promise<{
  view: { id: string; name: string; config: unknown } | null;
  ran: ReportQuery | null;
  rows: unknown[] | null;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: userAccounts } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .limit(1);

  const accountId = userAccounts?.[0]?.account_id;
  if (!accountId) throw new Error('No account found');

  const { data: saved } = await supabase
    .from('saved_reports')
    .select('id, name, config')
    .eq('module_name', moduleName)
    .eq('user_id', user.id)
    .maybeSingle();

  const def = getReportByModule(moduleName);
  // No definition in the registry means this report is driven entirely by a
  // config the server cannot see. Hand back the saved view and let the viewer
  // do what it always did.
  if (!def) return { view: saved ?? null, ran: null, rows: null };

  const savedConfig = (saved?.config ?? null) as Partial<ReportConfig> | null;
  const resolved = resolveSavedView(def, savedConfig, fallback);

  const ran: ReportQuery = {
    module: moduleForTab(def, resolved.tabKey),
    dimensions: resolved.dimensions,
    measures: resolved.measures,
    filters: (savedConfig?.filters ?? fallback.filters ?? {}) as Record<string, unknown>,
    sortColumn: savedConfig?.sortColumn ?? fallback.sortColumn ?? null,
    sortDirection: savedConfig?.sortDirection ?? fallback.sortDirection ?? 'asc',
    limit: fallback.limit,
    offset: 0,
  };

  const { data, error } = await supabase.rpc('execute_report', {
    p_account_id: accountId,
    p_module: ran.module,
    p_dimensions: ran.dimensions,
    p_measures: ran.measures,
    p_filters: ran.filters,
    p_sort_column: ran.sortColumn,
    p_sort_direction: ran.sortDirection,
    p_limit: ran.limit,
    p_offset: ran.offset,
  });

  if (error) {
    // Not thrown: the report must still open. The viewer re-queries.
    console.error('openReport: speculative query failed:', error.message);
    return { view: saved ?? null, ran, rows: null };
  }

  return { view: saved ?? null, ran, rows: (data ?? []) as unknown[] };
}

export async function executeReport(
  moduleName: string,
  dimensions: string[],
  measures: string[],
  filters: any = {},
  sortColumn?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
  limit?: number,
  offset: number = 0
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // get account_id
  const { data: userAccounts } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .limit(1);

  if (!userAccounts || userAccounts.length === 0) {
    throw new Error('No account found');
  }
  const accountId = userAccounts[0].account_id;

  const { data, error } = await supabase.rpc('execute_report', {
    p_account_id: accountId,
    p_module: moduleName,
    p_dimensions: dimensions,
    p_measures: measures,
    p_filters: filters,
    p_sort_column: sortColumn || null,
    p_sort_direction: sortDirection,
    p_limit: limit || null,
    p_offset: offset
  });

  if (error) {
    console.error('Report execution error:', error);
    throw new Error(error.message);
  }

  return data;
}

/**
 * Save (or overwrite) the caller's default view for a report module.
 *
 * There is exactly one per user per module — the unique constraint
 * saved_reports_user_module_key is the upsert target. Whatever is stored here is
 * how the report opens for that user from then on.
 */
export async function saveDefaultReportView(
  moduleName: string,
  name: string,
  config: ReportConfig
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: userAccounts } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .limit(1);

  const accountId = userAccounts?.[0]?.account_id;
  if (!accountId) throw new Error('No account found');

  const { data, error } = await supabase
    .from('saved_reports')
    .upsert(
      {
        account_id: accountId,
        user_id: user.id,
        module_name: moduleName,
        name,
        config,
        sharing_mode: 'private',
        is_default: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,module_name' }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// `getDefaultReportView` used to live here: it read the caller's saved view and
// nothing else, and the viewer then needed a second round trip to get its rows.
// `openReport` reads the same row and answers the first query in one response,
// and nothing imported the old action any more. Deleted rather than left
// sitting there, because two ways to read a saved view is two places for the
// handling of a stale one to drift apart — which is the exact hazard the guards
// in lib/reports/open-view.ts exist to close.

/** Forget the caller's default view so the module opens on the built-in layout. */
export async function clearDefaultReportView(moduleName: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('saved_reports')
    .delete()
    .eq('module_name', moduleName)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
}

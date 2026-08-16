'use server';

import { createClient } from '@/lib/supabase/server';
import type { ReportConfig } from '@/lib/reports/types';

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

/** The caller's default view for a module, or null if they haven't saved one. */
export async function getDefaultReportView(moduleName: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('saved_reports')
    .select('id, name, config')
    .eq('module_name', moduleName)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

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

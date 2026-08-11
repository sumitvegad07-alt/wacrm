'use server';

import { createClient } from '@/lib/supabase/server';

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

export async function saveReportConfig(
  moduleName: string,
  name: string,
  config: any,
  sharingMode: 'private' | 'team' | 'organization'
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

  const { data, error } = await supabase
    .from('saved_reports')
    .insert({
      account_id: accountId,
      user_id: user.id,
      module_name: moduleName,
      name,
      config,
      sharing_mode: sharingMode
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getSavedReports(moduleName: string) {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('saved_reports')
    .select('*')
    .eq('module_name', moduleName)
    .order('created_at', { ascending: false });
    
  if (error) throw new Error(error.message);
  return data;
}

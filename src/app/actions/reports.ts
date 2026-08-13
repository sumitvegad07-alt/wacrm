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

  if (moduleName === 'payment') {
    return await executePaymentReportLocal(supabase, accountId, dimensions, measures, filters, sortColumn, sortDirection, limit, offset);
  }

  // TEMPORARY LOGGING TO PROVE FILTER PAYLOAD REACHES RPC
  console.log("=== EXECUTING REPORT RPC ===");
  console.log("Payload p_filters:", JSON.stringify(filters, null, 2));
  console.log("============================");

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

// Local TS aggregation for payments to bypass the complex SQL RPC requirement
async function executePaymentReportLocal(
  supabase: any,
  accountId: string,
  dimensions: string[],
  measures: string[],
  filters: any = {},
  sortColumn?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
  limit?: number,
  offset: number = 0
) {
  let query = supabase
    .from('payments')
    .select(`
      *,
      contacts ( id, company, name )
    `)
    .eq('account_id', accountId);

  // Apply filters
  if (filters.date_range?.start_date) {
    query = query.gte('payment_date', filters.date_range.start_date);
  }
  if (filters.date_range?.end_date) {
    query = query.lte('payment_date', filters.date_range.end_date);
  }
  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status);
  }
  if (filters.source && filters.source.length > 0) {
    query = query.in('source', filters.source);
  }
  if (filters.user && filters.user.length > 0) {
    query = query.in('user_id', filters.user);
  }
  if (filters.customer && filters.customer.length > 0) {
    query = query.in('contact_id', filters.customer);
  }

  const { data: rawData, error } = await query;
  if (error) throw new Error(error.message);

  const payments = rawData || [];

  // Fetch profiles for manual join since no direct foreign key exists between payments and profiles
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('user_id, first_name, last_name')
    .eq('account_id', accountId);

  const profilesMap = new Map();
  if (profilesData) {
    profilesData.forEach((p: any) => {
      profilesMap.set(p.user_id, p);
    });
  }

  // Map to dimensions
  const grouped = new Map<string, any>();

  for (const p of payments) {
    const dimVals: Record<string, string> = {};
    for (const d of dimensions) {
      if (d === 'customer') dimVals[d] = p.contacts?.company || p.contacts?.name || 'Unknown';
      else if (d === 'user') {
        const prof = profilesMap.get(p.user_id);
        dimVals[d] = prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() : 'Unknown';
      }
      else if (d === 'payment_type') dimVals[d] = p.payment_type || 'Unknown';
      else if (d === 'source') dimVals[d] = p.source || 'Unknown';
      else if (d === 'date') dimVals[d] = p.payment_date || 'Unknown';
      else if (d === 'status') dimVals[d] = p.status || 'Unknown';
    }

    const groupKey = dimensions.map(d => dimVals[d]).join('|||');
    if (!grouped.has(groupKey)) {
      const initGroup: any = { ...dimVals };
      for (const m of measures) {
        initGroup[m] = 0;
      }
      initGroup._customer_set = new Set();
      grouped.set(groupKey, initGroup);
    }

    const g = grouped.get(groupKey);
    g.payment_count = (g.payment_count || 0) + 1;
    g.amount = (g.amount || 0) + Number(p.amount || 0);
    g.verified_amount = (g.verified_amount || 0) + Number(p.verified_amount ?? p.amount ?? 0);
    
    if (p.contact_id) g._customer_set.add(p.contact_id);
    g.customer_count = g._customer_set.size;
  }

  let result = Array.from(grouped.values());

  // Post-process computed measures
  if (measures.includes('avg_payment')) {
    for (const r of result) {
      r.avg_payment = r.payment_count > 0 ? (r.verified_amount / r.payment_count) : 0;
    }
  }

  // Sorting
  if (sortColumn) {
    result.sort((a, b) => {
      const valA = a[sortColumn];
      const valB = b[sortColumn];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
      const strA = String(valA || '');
      const strB = String(valB || '');
      return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }

  // Limit/Offset
  if (limit) {
    result = result.slice(offset, offset + limit);
  }

  // Remove internal sets
  for (const r of result) {
    delete r._customer_set;
  }

  return result;
}

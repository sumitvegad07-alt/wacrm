import type { SupabaseClient } from '@supabase/supabase-js'

export async function fetchTodaysCollection(supabase: SupabaseClient, accountId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data } = await supabase
    .from('payments')
    .select('amount, verified_amount')
    .eq('account_id', accountId)
    .eq('status', 'Approved')
    .gte('created_at', today.toISOString());
    
  return (data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
}

export async function fetchMonthlyCollection(supabase: SupabaseClient, accountId: string): Promise<{current: number, previous: number}> {
  const now = new Date();
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  
  const [currentData, previousData] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, verified_amount')
      .eq('account_id', accountId)
      .eq('status', 'Approved')
      .gte('created_at', startOfCurrentMonth.toISOString()),
    supabase
      .from('payments')
      .select('amount, verified_amount')
      .eq('account_id', accountId)
      .eq('status', 'Approved')
      .gte('created_at', startOfPreviousMonth.toISOString())
      .lt('created_at', startOfCurrentMonth.toISOString())
  ]);

  const current = (currentData.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
  const previous = (previousData.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
  
  return { current, previous };
}

export async function fetchCollectionByPaymentType(supabase: SupabaseClient, accountId: string): Promise<{name: string, amount: number}[]> {
  const { data } = await supabase
    .from('payments')
    .select('payment_mode, amount, verified_amount')
    .eq('account_id', accountId)
    .eq('status', 'Approved');
    
  const typeMap: Record<string, number> = {};
  (data || []).forEach(p => {
    const type = p.payment_mode || 'Other';
    typeMap[type] = (typeMap[type] || 0) + (p.verified_amount ?? p.amount);
  });
  
  return Object.entries(typeMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export async function fetchCollectionByUser(supabase: SupabaseClient, accountId: string): Promise<{name: string, amount: number}[]> {
  const { data } = await supabase
    .from('payments')
    .select('amount, verified_amount, user_id')
    .eq('account_id', accountId)
    .eq('status', 'Approved');
    
  if (!data) return [];
  
  const userMap: Record<string, number> = {};
  data.forEach(p => {
    const uid = p.user_id || 'Unknown';
    userMap[uid] = (userMap[uid] || 0) + (p.verified_amount ?? p.amount);
  });
  
  const userIds = Object.keys(userMap).filter(id => id !== 'Unknown');
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name')
    .in('user_id', userIds);
    
  const profileMap = (profiles || []).reduce((acc: any, p: any) => {
    acc[p.user_id] = p.full_name || 'Unknown User';
    return acc;
  }, {});
  
  return Object.entries(userMap).map(([id, amount]) => ({
    name: id === 'Unknown' ? 'Unknown' : (profileMap[id] || 'Unknown User'),
    amount
  })).sort((a, b) => b.amount - a.amount);
}

export async function fetchTotalOutstanding(supabase: SupabaseClient, accountId: string): Promise<number> {
  const [ordersRes, paymentsRes, contactsRes] = await Promise.all([
    supabase.from('orders').select('total_amount').eq('account_id', accountId).eq('status', 'Closed'),
    supabase.from('payments').select('amount, verified_amount').eq('account_id', accountId).eq('status', 'Approved'),
    supabase.from('contacts').select('opening_balance').eq('account_id', accountId)
  ]);
  
  const totalOrders = (ordersRes.data || []).reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const totalPayments = (paymentsRes.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
  const totalOpening = (contactsRes.data || []).reduce((sum, c) => sum + (c.opening_balance || 0), 0);
  
  return totalOrders - totalPayments + totalOpening;
}

export async function fetchPendingApprovalAging(supabase: SupabaseClient, accountId: string) {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  const { data } = await supabase
    .from('payments')
    .select(`
      id, 
      payment_number, 
      amount, 
      created_at, 
      contacts (name)
    `)
    .eq('account_id', accountId)
    .eq('status', 'Pending')
    .lt('created_at', threeDaysAgo.toISOString())
    .order('created_at', { ascending: true });
    
  const payments = (data || []).map((p: any) => {
    const days = Math.floor((new Date().getTime() - new Date(p.created_at).getTime()) / (1000 * 3600 * 24));
    return {
      id: p.id,
      payment_number: p.payment_number,
      amount: p.amount,
      customer: p.contacts?.name || 'Unknown',
      days_pending: days
    };
  });
  
  return {
    count: payments.length,
    payments
  };
}

export async function fetchOverdueCustomers(supabase: SupabaseClient, accountId: string) {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, company, credit_days, opening_balance')
    .eq('account_id', accountId)
    .not('credit_days', 'is', null);
    
  if (!contacts) return [];
  
  const { data: orders } = await supabase.from('orders').select('contact_id, total_amount, created_at').eq('account_id', accountId).eq('status', 'Closed').order('created_at', { ascending: true });
  const { data: payments } = await supabase.from('payments').select('contact_id, amount, verified_amount').eq('account_id', accountId).eq('status', 'Approved');
  
  const paymentsByContact: Record<string, number> = {};
  (payments || []).forEach(p => {
    paymentsByContact[p.contact_id] = (paymentsByContact[p.contact_id] || 0) + (p.verified_amount ?? p.amount);
  });
  
  const overdue: any[] = [];
  
  contacts.forEach(c => {
    const cOrders = (orders || []).filter(o => o.contact_id === c.id);
    let paidAmount = paymentsByContact[c.id] || 0;
    
    let outstanding = (c.opening_balance || 0);
    if (paidAmount >= outstanding) {
      paidAmount -= outstanding;
    } else {
      outstanding -= paidAmount;
      paidAmount = 0;
    }
    
    let isOverdue = false;
    let maxDaysOverdue = 0;
    let totalOutstanding = (c.opening_balance || 0) - (paymentsByContact[c.id] || 0);
    
    cOrders.forEach(o => {
      totalOutstanding += o.total_amount;
      if (paidAmount >= o.total_amount) {
        paidAmount -= o.total_amount;
      } else {
        paidAmount = 0;
        const daysOld = Math.floor((new Date().getTime() - new Date(o.created_at).getTime()) / (1000 * 3600 * 24));
        if (c.credit_days && daysOld > c.credit_days) {
          isOverdue = true;
          maxDaysOverdue = Math.max(maxDaysOverdue, daysOld - c.credit_days);
        }
      }
    });
    
    if (isOverdue && totalOutstanding > 0) {
      overdue.push({
        id: c.id,
        name: c.name,
        outstanding: totalOutstanding,
        days_overdue: maxDaysOverdue
      });
    }
  });
  
  return overdue.sort((a, b) => b.days_overdue - a.days_overdue);
}

export async function fetchCreditExceededCustomers(supabase: SupabaseClient, accountId: string) {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, company, credit_limit, opening_balance')
    .eq('account_id', accountId)
    .not('credit_limit', 'is', null);
    
  if (!contacts) return [];
  
  const { data: orders } = await supabase.from('orders').select('contact_id, total_amount').eq('account_id', accountId).eq('status', 'Closed');
  const { data: payments } = await supabase.from('payments').select('contact_id, amount, verified_amount').eq('account_id', accountId).eq('status', 'Approved');
  
  const ordersByContact: Record<string, number> = {};
  (orders || []).forEach(o => {
    ordersByContact[o.contact_id] = (ordersByContact[o.contact_id] || 0) + o.total_amount;
  });
  
  const paymentsByContact: Record<string, number> = {};
  (payments || []).forEach(p => {
    paymentsByContact[p.contact_id] = (paymentsByContact[p.contact_id] || 0) + (p.verified_amount ?? p.amount);
  });
  
  const exceeded: any[] = [];
  
  contacts.forEach(c => {
    if (!c.credit_limit) return;
    
    const outstanding = (c.opening_balance || 0) + (ordersByContact[c.id] || 0) - (paymentsByContact[c.id] || 0);
    if (outstanding > c.credit_limit) {
      exceeded.push({
        id: c.id,
        name: c.name,
        credit_limit: c.credit_limit,
        outstanding,
        available_credit: c.credit_limit - outstanding 
      });
    }
  });
  
  return exceeded.sort((a, b) => b.outstanding - a.outstanding);
}

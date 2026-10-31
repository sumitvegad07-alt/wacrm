import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutstandingConfig } from '@/lib/payments/outstanding-config'
import { callAggregateRpc, num } from './aggregate-rpc'
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  startOfAccountDay,
  startOfAccountMonth,
  startOfPreviousAccountMonth,
} from './date-utils'

// Collection KPIs count RECORDED payments — Approved plus those still Pending
// approval — so a payment a rep just entered shows up immediately instead of
// reading zero until an admin approves it. Rejected/Cancelled are excluded.
// (Outstanding/overdue/credit calcs below take the account's own rule instead —
// see OutstandingConfig. `config` is required on those three so a caller cannot
// quietly fall back to a different rule than the rest of the app shows.)
const RECORDED_STATUSES = ['Approved', 'Pending'] as const;

const RECORDED = RECORDED_STATUSES as unknown as string[];

// ---------------------------------------------------------------------------
// Every total on this board is now summed by the database, not by the browser.
//
// These functions used to `.select()` rows and reduce them in JS. PostgREST
// caps an unbounded select at 1,000 rows and reports nothing, so each figure
// was silently short on any tenant past that — and several of them selected
// EVERY order and EVERY payment of the account with no range at all. Measured
// on the live Satyam account: 2,126 Closed orders and 1,068 Approved payments,
// true outstanding 17,188,513.62, figure shown -32,348,000.98. The subtraction
// inverted because the two sides lost different numbers of rows.
//
// Day and month boundaries came from `new Date()` — the viewer's laptop clock.
// They now come from the account's own timezone, per the house rule, so a
// dashboard figure and a report figure for the same day agree.
//
// `timezone` on each function is the account's IANA zone, from
// `accountTimezone(account.settings)`. The RPC resolves the account's
// boundaries itself; the argument only steers the pre-migration fallback so
// that path lands on the same instant.
//
// See aggregate-rpc.ts for why the old implementations are still here.
// ---------------------------------------------------------------------------

interface CollectionTotalsRow {
  today: number | string | null;
  month_current: number | string | null;
  month_previous: number | string | null;
}

/** One RPC answers both collection widgets; each picks the field it shows. */
async function collectionTotals(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CollectionTotalsRow | null> {
  const rpc = await callAggregateRpc<CollectionTotalsRow>(
    supabase,
    'dashboard_collection_totals',
    { p_account_id: accountId, p_statuses: RECORDED },
  );
  return rpc.ok ? rpc.data : null;
}

export async function fetchTodaysCollection(
  supabase: SupabaseClient,
  accountId: string,
  timezone: string = DEFAULT_ACCOUNT_TIMEZONE,
): Promise<number> {
  const totals = await collectionTotals(supabase, accountId);
  if (totals) return num(totals.today);

  const today = startOfAccountDay(timezone);

  const { data } = await supabase
    .from('payments')
    .select('amount, verified_amount')
    .eq('account_id', accountId)
    .in('status', RECORDED)
    .gte('created_at', today.toISOString());

  return (data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
}

export async function fetchMonthlyCollection(
  supabase: SupabaseClient,
  accountId: string,
  timezone: string = DEFAULT_ACCOUNT_TIMEZONE,
): Promise<{current: number, previous: number}> {
  const totals = await collectionTotals(supabase, accountId);
  if (totals) {
    return { current: num(totals.month_current), previous: num(totals.month_previous) };
  }

  const startOfCurrentMonth = startOfAccountMonth(timezone);
  const startOfPreviousMonth = startOfPreviousAccountMonth(timezone);

  const [currentData, previousData] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, verified_amount')
      .eq('account_id', accountId)
      .in('status', RECORDED)
      .gte('created_at', startOfCurrentMonth.toISOString()),
    supabase
      .from('payments')
      .select('amount, verified_amount')
      .eq('account_id', accountId)
      .in('status', RECORDED)
      .gte('created_at', startOfPreviousMonth.toISOString())
      .lt('created_at', startOfCurrentMonth.toISOString())
  ]);

  const current = (currentData.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
  const previous = (previousData.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);

  return { current, previous };
}

/**
 * Collection split by payment type.
 *
 * THIS CHART HAS NEVER SHOWN ANYTHING. It selected `payment_mode`, and there
 * is no such column — the real one is `payments.payment_type`. PostgREST
 * answered HTTP 400 ("column payments.payment_mode does not exist"), `data`
 * came back undefined, and the widget rendered an empty chart for every
 * tenant rather than raising. Confirmed against production 2026-10-31.
 */
export async function fetchCollectionByPaymentType(supabase: SupabaseClient, accountId: string): Promise<{name: string, amount: number}[]> {
  const rpc = await callAggregateRpc<{ name: string; amount: number | string }[]>(
    supabase,
    'dashboard_collection_by_type',
    { p_account_id: accountId, p_statuses: RECORDED },
  );
  if (rpc.ok) {
    return (rpc.data ?? []).map((r) => ({ name: r.name, amount: num(r.amount) }));
  }

  const { data } = await supabase
    .from('payments')
    .select('payment_type, amount, verified_amount')
    .eq('account_id', accountId)
    .in('status', RECORDED);

  const typeMap: Record<string, number> = {};
  (data || []).forEach(p => {
    const type = p.payment_type || 'Other';
    typeMap[type] = (typeMap[type] || 0) + (p.verified_amount ?? p.amount);
  });

  return Object.entries(typeMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export async function fetchCollectionByUser(supabase: SupabaseClient, accountId: string): Promise<{name: string, amount: number}[]> {
  const rpc = await callAggregateRpc<{ name: string; amount: number | string }[]>(
    supabase,
    'dashboard_collection_by_user',
    { p_account_id: accountId, p_statuses: RECORDED },
  );
  if (rpc.ok) {
    return (rpc.data ?? []).map((r) => ({ name: r.name, amount: num(r.amount) }));
  }

  const { data } = await supabase
    .from('payments')
    .select('amount, verified_amount, user_id')
    .eq('account_id', accountId)
    .in('status', RECORDED);

  if (!data) return [];

  const userMap: Record<string, number> = {};
  data.forEach(p => {
    const uid = p.user_id || 'Unknown';
    userMap[uid] = (userMap[uid] || 0) + (p.verified_amount ?? p.amount);
  });

  // payments.user_id is an AUTH user id, so it matches profiles.user_id — not
  // profiles.id. The two id spaces are genuinely different in this schema and
  // joining the wrong one returns nothing at all, silently.
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

export async function fetchTotalOutstanding(supabase: SupabaseClient, accountId: string, config: OutstandingConfig): Promise<number> {
  const rpc = await callAggregateRpc<{ outstanding: number | string }>(
    supabase,
    'dashboard_total_outstanding',
    {
      p_account_id: accountId,
      p_order_statuses: config.orderStatuses,
      p_payment_statuses: config.paymentStatuses,
    },
  );
  if (rpc.ok) return num(rpc.data.outstanding);

  const [ordersRes, paymentsRes, contactsRes] = await Promise.all([
    supabase.from('orders').select('total_amount').eq('account_id', accountId).in('status', config.orderStatuses),
    supabase.from('payments').select('amount, verified_amount').eq('account_id', accountId).in('status', config.paymentStatuses),
    supabase.from('contacts').select('opening_balance').eq('account_id', accountId)
  ]);

  const totalOrders = (ordersRes.data || []).reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const totalPayments = (paymentsRes.data || []).reduce((sum, p) => sum + (p.verified_amount ?? p.amount), 0);
  const totalOpening = (contactsRes.data || []).reduce((sum, c) => sum + (c.opening_balance || 0), 0);

  return totalOrders - totalPayments + totalOpening;
}

/** How long a payment may sit unapproved before it is "aging". Elapsed days, not a calendar boundary. */
const AGING_DAYS = 3;
/** The widget shows a short list; the count beside it is the real total. */
const AGING_LIST_LIMIT = 100;

export async function fetchPendingApprovalAging(supabase: SupabaseClient, accountId: string) {
  const rpc = await callAggregateRpc<{
    count: number | string;
    payments: {
      id: string;
      payment_number: string | null;
      amount: number | string | null;
      customer: string;
      days_pending: number | string | null;
    }[];
  }>(supabase, 'dashboard_pending_approval_aging', {
    p_account_id: accountId,
    p_days: AGING_DAYS,
    p_limit: AGING_LIST_LIMIT,
  });

  if (rpc.ok) {
    return {
      // The count used to BE the list's length, so an account with more than
      // 1,000 stale payments reported exactly 1,000 — and the browser parsed
      // every one of them to show a handful.
      count: num(rpc.data.count),
      payments: (rpc.data.payments ?? []).map((p) => ({
        id: p.id,
        payment_number: p.payment_number,
        amount: num(p.amount),
        customer: p.customer,
        days_pending: num(p.days_pending),
      })),
    };
  }

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - AGING_DAYS);

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

/** Receivables lists are shown in full in their own modules; the widget needs a board, not a ledger. */
const CUSTOMER_LIST_LIMIT = 200;

export async function fetchOverdueCustomers(supabase: SupabaseClient, accountId: string, config: OutstandingConfig) {
  const rpc = await callAggregateRpc<
    { id: string; name: string; outstanding: number | string; days_overdue: number | string }[]
  >(supabase, 'dashboard_overdue_customers', {
    p_account_id: accountId,
    p_order_statuses: config.orderStatuses,
    p_payment_statuses: config.paymentStatuses,
    p_limit: CUSTOMER_LIST_LIMIT,
  });

  if (rpc.ok) {
    return (rpc.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      outstanding: num(r.outstanding),
      days_overdue: num(r.days_overdue),
    }));
  }

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, company, credit_days, opening_balance')
    .eq('account_id', accountId)
    .not('credit_days', 'is', null);

  if (!contacts) return [];

  const { data: orders } = await supabase.from('orders').select('contact_id, total_amount, created_at').eq('account_id', accountId).in('status', config.orderStatuses).order('created_at', { ascending: true });
  const { data: payments } = await supabase.from('payments').select('contact_id, amount, verified_amount').eq('account_id', accountId).in('status', config.paymentStatuses);

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

export async function fetchCreditExceededCustomers(supabase: SupabaseClient, accountId: string, config: OutstandingConfig) {
  const rpc = await callAggregateRpc<
    {
      id: string;
      name: string;
      credit_limit: number | string;
      outstanding: number | string;
      available_credit: number | string;
    }[]
  >(supabase, 'dashboard_credit_exceeded_customers', {
    p_account_id: accountId,
    p_order_statuses: config.orderStatuses,
    p_payment_statuses: config.paymentStatuses,
    p_limit: CUSTOMER_LIST_LIMIT,
  });

  if (rpc.ok) {
    return (rpc.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      credit_limit: num(r.credit_limit),
      outstanding: num(r.outstanding),
      available_credit: num(r.available_credit),
    }));
  }

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, company, credit_limit, opening_balance')
    .eq('account_id', accountId)
    .not('credit_limit', 'is', null);

  if (!contacts) return [];

  const { data: orders } = await supabase.from('orders').select('contact_id, total_amount').eq('account_id', accountId).in('status', config.orderStatuses);
  const { data: payments } = await supabase.from('payments').select('contact_id, amount, verified_amount').eq('account_id', accountId).in('status', config.paymentStatuses);

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

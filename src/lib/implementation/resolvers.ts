import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnswerMap } from './types';

export interface ResolverCtx {
  accountId: string;
  supabase: SupabaseClient;
  params?: Record<string, unknown> | null;
  answers: AnswerMap;
}
export type Resolver = (ctx: ResolverCtx) => Promise<number | boolean>;

// COUNT helper: head+count is cheapest against real Supabase; the test mock
// resolves {count} directly and ignores the chained modifiers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase builder is dynamically chained
async function countRows(ctx: ResolverCtx, table: string, extra?: (q: any) => any): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chained builder
  let q: any = ctx.supabase.from(table).select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId);
  if (extra) q = extra(q);
  const { count } = await q;
  return count ?? 0;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- chained builder
async function existsRows(ctx: ResolverCtx, table: string, extra?: (q: any) => any): Promise<boolean> {
  return (await countRows(ctx, table, extra)) > 0;
}

export const RESOLVERS: Record<string, Resolver> = {
  territory_count: (ctx) => countRows(ctx, 'territories'),
  customer_count: (ctx) => countRows(ctx, 'contacts'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chained builder
  role_count: (ctx) => countRows(ctx, 'employee_roles', (q: any) => q.eq('status', 'active')),
  employee_count: (ctx) => countRows(ctx, 'profiles'),
  employee_logged_in: async (ctx) => {
    // "An employee logged into the MOBILE app." Use mobile-only signals so the
    // web admin's own session never trips this: push_tokens (registered when the
    // Expo app logs in) OR a tracking_session (mobile punch-in). Deliberately NOT
    // member_presence, which includes the admin's web presence.
    const [pushed, session] = await Promise.all([
      existsRows(ctx, 'push_tokens'),
      existsRows(ctx, 'tracking_sessions'),
    ]);
    return pushed || session;
  },
  attendance_or_visit: async (ctx) => {
    const [sessions, visits] = await Promise.all([
      existsRows(ctx, 'tracking_sessions'),
      existsRows(ctx, 'site_visits'),
    ]);
    return sessions || visits;
  },
  meaningful_data: async (ctx) => {
    const [pings, visits, sessions] = await Promise.all([
      existsRows(ctx, 'location_pings'),
      existsRows(ctx, 'site_visits'),
      existsRows(ctx, 'tracking_sessions'),
    ]);
    return pings || visits || sessions;
  },
  answer: async (ctx) => {
    const key = ctx.params?.question_key as string | undefined;
    if (!key) return false;
    const v = ctx.answers[key];
    return v !== undefined && v !== null && v !== '';
  },
};

export async function runResolver(sourceKey: string, ctx: ResolverCtx): Promise<number | boolean> {
  const r = RESOLVERS[sourceKey];
  if (!r) throw new Error(`Unknown validation source_key: ${sourceKey}`);
  return r(ctx);
}

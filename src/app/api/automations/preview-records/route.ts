import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/automations/preview-records?module=order
 *
 * Recent records of the right kind, so Test mode offers a real thing to pick
 * rather than asking an admin to paste an id.
 *
 * Lives here rather than in the dialog because UI components must not query
 * Supabase directly, and because account scoping belongs in one place.
 */
const querySchema = z.object({
  module: z.enum(['customer', 'order', 'dispatch']),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const parsed = querySchema.safeParse({
      module: new URL(request.url).searchParams.get('module'),
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'module must be one of: customer, order, dispatch' },
        { status: 400 },
      )
    }

    // Queried per table with a literal select — the typed client can only infer
    // row shapes from a literal, and a dynamic column string loses all typing.
    if (parsed.data.module === 'order') {
      const { data } = await ctx.supabase
        .from('orders')
        .select('id, order_number')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(25)
      return NextResponse.json({
        records: (data ?? []).map((r) => ({
          id: r.id,
          label: r.order_number || 'Untitled order',
        })),
      })
    }

    if (parsed.data.module === 'dispatch') {
      const { data } = await ctx.supabase
        .from('order_dispatches')
        .select('id, dispatch_number')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(25)
      return NextResponse.json({
        records: (data ?? []).map((r) => ({
          id: r.id,
          label: r.dispatch_number || 'Untitled dispatch',
        })),
      })
    }

    const { data } = await ctx.supabase
      .from('contacts')
      .select('id, company, name')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(25)
    return NextResponse.json({
      records: (data ?? []).map((r) => ({
        id: r.id,
        label: r.company || r.name || 'Unnamed customer',
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

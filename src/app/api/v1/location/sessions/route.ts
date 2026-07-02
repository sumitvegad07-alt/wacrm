import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

async function getSupabaseUser(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 }) }
  }
  const token = authHeader.split(' ')[1]

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      cookies: { getAll: () => [], setAll: () => {} }
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile?.account_id) {
    return { error: NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 }) }
  }

  return { supabase, user, accountId: profile.account_id }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, accountId, error } = await getSupabaseUser(request)
    if (error) return error

    const body = await request.json()
    const { device_id } = body

    if (!device_id) {
      return NextResponse.json({ error: 'device_id is required' }, { status: 400 })
    }

    // End any existing active sessions for this user/device
    await supabase
      .from('tracking_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'timeout' })
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .is('ended_at', null)

    const { data, error: insertError } = await supabase
      .from('tracking_sessions')
      .insert({
        account_id: accountId,
        user_id: user.id,
        device_id
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error starting session:', insertError)
      return NextResponse.json({ error: 'Failed to start session' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('Error in session POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user, accountId, error } = await getSupabaseUser(request)
    if (error) return error

    const body = await request.json()
    const { session_id, end_reason } = body

    if (!session_id || !end_reason) {
      return NextResponse.json({ error: 'session_id and end_reason are required' }, { status: 400 })
    }

    const { data, error: updateError } = await supabase
      .from('tracking_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason })
      .eq('id', session_id)
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .is('ended_at', null)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: 'Failed to end session or session not active' }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('Error in session PATCH:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

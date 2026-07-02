import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 })
    }
    const token = authHeader.split(' ')[1]

    // Create a Supabase client configured with the incoming Bearer token
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        cookies: {
          getAll: () => [],
          setAll: () => {},
        }
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limit specifically for location ping uploads
    const limit = checkRateLimit(`location_pings:${user.id}`, RATE_LIMITS.locationPings)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const { session_id, pings } = body

    if (!session_id || !Array.isArray(pings)) {
      return NextResponse.json({ error: 'session_id and pings array are required' }, { status: 400 })
    }

    // Resolve the account_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 })
    }

    // Validate the session belongs to the user and is active
    const { data: session, error: sessionErr } = await supabase
      .from('tracking_sessions')
      .select('id, ended_at')
      .eq('id', session_id)
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (sessionErr || !session) {
      return NextResponse.json({ error: 'Tracking session not found' }, { status: 404 })
    }

    if (session.ended_at) {
      return NextResponse.json({ error: 'Tracking session has already ended' }, { status: 400 })
    }

    // Prepare batch
    const insertData = pings.map(p => ({
      account_id: accountId,
      session_id,
      user_id: user.id,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracy_m || null,
      speed_mps: p.speed_mps || null,
      battery_pct: p.battery_pct || null,
      recorded_at: p.recorded_at, // Device clock timestamp
      // received_at defaults to NOW()
    }))

    if (insertData.length === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }

    // Perform batch insert with ON CONFLICT DO NOTHING (idempotency via session_id + recorded_at)
    // The Supabase JS client doesn't natively expose `ON CONFLICT DO NOTHING` easily for arbitrary constraints 
    // unless using rpc, but `onConflict: 'session_id, recorded_at', ignoreDuplicates: true` usually translates correctly.
    const { error: insertError } = await supabase
      .from('location_pings')
      .upsert(insertData, {
        onConflict: 'session_id, recorded_at',
        ignoreDuplicates: true,
      })

    if (insertError) {
      console.error('Error inserting location pings:', insertError)
      return NextResponse.json({ error: 'Failed to insert pings' }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: insertData.length })
  } catch (error) {
    console.error('Error in location pings POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

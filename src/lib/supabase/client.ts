import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createRecoveringFetch } from './session-recovery'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

/** Pages that must not be bounced to the sign-in screen. */
const PUBLIC_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/join', '/auth']

/**
 * The session is past saving. Send the user to sign in, remembering where they
 * were — before this, a tab with a dead session simply sat on its spinners and
 * answered every save with a generic failure (tenant 001300, 31 Oct 2026).
 */
function goToLogin() {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return
  const next = encodeURIComponent(`${pathname}${search}`)
  window.location.replace(`/login?expired=1&next=${next}`)
}

export function createClient() {
  if (browserClient) return browserClient

  // The wrapper needs the client to refresh with, and the client needs the
  // wrapper to fetch with. `browserClient` is assigned below before any
  // request can be made through it, so it is always set by the time `refresh`
  // runs.
  const recoveringFetch = createRecoveringFetch({
    fetchImpl: (input, init) => fetch(input, init),
    refresh: async (staleToken) => {
      if (!browserClient) return null
      const { data, error } = await browserClient.auth.refreshSession()
      if (!error && data.session?.access_token) return data.session.access_token

      // The refresh token is rotated on every use, so supabase-js's own timer —
      // or another tab — may have spent ours and already stored a good session.
      // Ask before concluding the user is signed out: treating that race as a
      // dead session would throw out somebody who is perfectly fine. Anything
      // but a genuinely newer token counts as a failure.
      const { data: current } = await browserClient.auth.getSession()
      const token = current.session?.access_token ?? null
      return token && token !== staleToken ? token : null
    },
    onSessionLost: goToLogin,
  })

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: recoveringFetch } },
  )

  return browserClient
}

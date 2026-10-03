// ============================================================
// Turning a bearer token into a working, admin-scoped Supabase client.
//
// This is the reason the whole module is safe. Every AI query runs under the
// connecting admin's own session, so execute_report (SECURITY INVOKER) keeps
// working untouched and RLS enforces tenant isolation at the database rather
// than relying on an explicit account filter in our code.
//
// Three wrinkles, all handled here:
//
//  1. Supabase rotates the refresh token on every use. The rotated value MUST
//     be written back, or the connection bricks itself on the next call.
//  2. Two concurrent AI calls on one connection would each try to redeem the
//     same refresh token; the loser gets an invalid-token error and the
//     connection dies. Refreshes are therefore serialised per connection and
//     the resulting session cached until it is nearly expired.
//  3. account_role is re-read through the admin's own client on every call,
//     so a demoted admin loses access immediately rather than at next
//     refresh.
// ============================================================
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { TenantContext } from "./gating";
import { assertDailyBudget } from "./limits";
import {
  findConnectionByAccessToken,
  touchConnection,
  updateStoredSbRefresh,
} from "./oauth/store";

/** Message the admin sees, via their AI tool, when the session is dead.
 *  Deliberately an instruction, not a diagnosis. */
export const RECONNECT_MESSAGE =
  "Your OZZO connection has expired. Please reconnect OZZO in your AI tool.";

/** Roles that may use the connector. Admin-or-above, forever (spec §2). */
const ADMIN_ROLES = new Set(["admin", "owner", "superadmin"]);

/** Default account timezone, matching src/lib/retention/run.ts. */
const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Refresh when the cached session has less than this left to run. */
const REFRESH_SKEW_MS = 60_000;

export class McpAuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "McpAuthError";
    this.status = status;
    this.code = code;
  }
}

export interface McpContext {
  connectionId: string;
  accountId: string;
  profileId: string;
  clientName: string;
  /** The tenant's company name, so the AI can say whose data it is reading. */
  accountName: string;
  /** Authenticated AS THE ADMIN. Never a service-role client. */
  supabase: SupabaseClient;
  tenant: TenantContext;
  timezone: string;
}

interface CachedSession {
  accessToken: string;
  expiresAtMs: number;
}

/** connectionId -> the in-flight or completed refresh. Serialises point 2. */
const sessionCache = new Map<string, CachedSession>();
const inFlight = new Map<string, Promise<CachedSession>>();

/** Test seam: clears the per-process session cache. */
export function __resetMcpSessionCacheForTests(): void {
  sessionCache.clear();
  inFlight.clear();
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Exchange the stored refresh token for a live access token, at most once at
 * a time per connection, persisting the rotated refresh token.
 */
async function refreshAdminSession(
  connectionId: string,
  storedRefreshToken: string,
): Promise<CachedSession> {
  const cached = sessionCache.get(connectionId);
  if (cached && cached.expiresAtMs - REFRESH_SKEW_MS > Date.now()) return cached;

  const existing = inFlight.get(connectionId);
  if (existing) return existing;

  const promise = (async (): Promise<CachedSession> => {
    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await anon.auth.refreshSession({
      refresh_token: storedRefreshToken,
    });
    if (error || !data.session) {
      // A password change, a sign-out-everywhere, or a token already spent
      // all land here. There is nothing the admin can do but reconnect.
      throw new McpAuthError(401, "session_expired", RECONNECT_MESSAGE);
    }

    // Write the rotated refresh token back before anyone can use the session,
    // so a crash mid-request cannot leave the stored token behind the real one.
    if (data.session.refresh_token) {
      await updateStoredSbRefresh(connectionId, data.session.refresh_token);
    }

    const expiresAtMs = data.session.expires_at
      ? data.session.expires_at * 1000
      : Date.now() + (data.session.expires_in ?? 3600) * 1000;

    const fresh: CachedSession = {
      accessToken: data.session.access_token,
      expiresAtMs,
    };
    sessionCache.set(connectionId, fresh);
    return fresh;
  })();

  inFlight.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(connectionId);
  }
}

/** A Supabase client that sends the admin's access token on every request. */
function clientForAccessToken(accessToken: string): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

/**
 * Resolve the request's bearer token to a full, admin-scoped context.
 *
 * Throws McpAuthError, whose message is written to be read by a human via
 * their AI tool — the AI relays it, so "reconnect OZZO in your AI tool" is
 * more useful than any status code.
 */
export async function requireMcpContext(request: Request): Promise<McpContext> {
  const token = bearerFrom(request);
  if (!token) {
    throw new McpAuthError(
      401,
      "unauthorized",
      "No OZZO access token was sent. Connect OZZO in your AI tool first.",
    );
  }

  const connection = await findConnectionByAccessToken(token);
  if (!connection) {
    throw new McpAuthError(401, "invalid_token", RECONNECT_MESSAGE);
  }

  const session = await refreshAdminSession(
    connection.id,
    connection.sb_refresh_token,
  );
  const supabase = clientForAccessToken(session.accessToken);

  // Re-read the role through the admin's OWN client, so RLS applies and a
  // demotion takes effect on the very next call.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, account_id, account_role")
    .eq("id", connection.profile_id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new McpAuthError(
      403,
      "forbidden",
      "This OZZO user no longer exists or cannot be read. Please reconnect.",
    );
  }

  const role = String((profile as { account_role?: string }).account_role ?? "");
  if (!ADMIN_ROLES.has(role.toLowerCase())) {
    throw new McpAuthError(
      403,
      "forbidden",
      "Only an Admin can read OZZO data from an AI tool. This user is no longer an Admin.",
    );
  }

  // Real column names: the plan lives in `subscription_plan`, and
  // module_settings is a top-level jsonb column, NOT nested inside settings.
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name, subscription_plan, module_settings, settings")
    .eq("id", connection.account_id)
    .maybeSingle();

  if (accountError || !account) {
    throw new McpAuthError(
      403,
      "forbidden",
      "This OZZO account could not be read. Please reconnect.",
    );
  }

  const settings = ((account as { settings?: Record<string, unknown> }).settings ??
    {}) as Record<string, unknown>;
  const timezone =
    typeof settings.timezone === "string" && settings.timezone
      ? settings.timezone
      : DEFAULT_TIMEZONE;

  await assertDailyBudget(connection.account_id, timezone);

  const tenant: TenantContext = {
    // Passed through raw. planLines() in gating.ts applies the product rule
    // that a legacy plan (production has one on "Enterprise") gets full
    // access, which a cast to PlanId would silently break.
    plan: (account as { subscription_plan?: unknown }).subscription_plan,
    moduleSettings: readModuleSettings(
      (account as { module_settings?: unknown }).module_settings,
    ),
    allowWorkforceData: settings.mcp_allow_workforce_data === true,
  };

  // Awaited for the same reason as the audit write: a promise left in flight
  // when a serverless function returns can simply be killed. If this never
  // lands, last_used_at goes stale and the 90-day idle rule eventually kills
  // a connection that is in daily use. Only written when it is actually
  // stale, so the common case costs nothing.
  if (isStale(connection.last_used_at)) {
    try {
      await touchConnection(connection.id);
    } catch {
      // A failed bookkeeping write must not fail the admin's question.
    }
  }

  return {
    connectionId: connection.id,
    accountId: connection.account_id,
    profileId: connection.profile_id,
    clientName: connection.client_name,
    accountName: String((account as { name?: string }).name ?? ""),
    supabase,
    tenant,
    timezone,
  };
}

/** Only refresh last_used_at when it has drifted, to avoid a write per call. */
const TOUCH_AFTER_MS = 15 * 60_000;

function isStale(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) return true;
  const t = new Date(lastUsedAt).getTime();
  return !Number.isFinite(t) || Date.now() - t > TOUCH_AFTER_MS;
}

/** Module toggles live in the top-level accounts.module_settings column. */
function readModuleSettings(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

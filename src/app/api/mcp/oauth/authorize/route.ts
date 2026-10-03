// ============================================================
// The Allow screen — the only moment in this whole feature where a human
// makes a real choice.
//
// Every failure here renders readable HTML rather than JSON, because a
// person is looking at it, not a program. The one exception that matters
// most: a bad redirect_uri must NOT redirect anywhere. Bouncing the browser
// to an unregistered URI with an error on it is itself the open-redirect
// bug this endpoint exists to prevent.
//
// The module list on the screen is generated from the tenant's real
// entitlements, so it can never promise more than the AI will actually be
// able to read.
// ============================================================
import { NextResponse } from "next/server";
import { visibleDataSets } from "@/lib/mcp/gating";
import type { TenantContext } from "@/lib/mcp/gating";
import { isSupportedChallengeMethod } from "@/lib/mcp/oauth/pkce";
import { isRegisteredRedirectUri } from "@/lib/mcp/oauth/redirect-uri";
import { createAuthCode, getClient } from "@/lib/mcp/oauth/store";
import { createClient } from "@/lib/supabase/server";

/** Roles allowed to connect an AI tool. Mirrors session.ts. */
const ADMIN_ROLES = new Set(["admin", "owner", "superadmin"]);

interface ValidatedRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
}

/** A failure we may safely report back to the client via its redirect_uri. */
interface RedirectableError {
  redirectUri: string;
  state: string | null;
  error: string;
  description: string;
}

type ValidationResult =
  | { ok: true; value: ValidatedRequest }
  | { ok: false; page: string }
  | { ok: false; redirect: RedirectableError };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // This page must never be framed — a clickjacked Allow button would
      // connect an AI tool without the admin realising.
      "X-Frame-Options": "DENY",
    },
  });
}

/** Minimal, self-contained page. No app chrome: this renders for a signed-out
 *  visitor too, and must not depend on the dashboard's providers. */
function page(opts: {
  title: string;
  body: string;
  status?: number;
}): NextResponse {
  return htmlResponse(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)} — OZZO</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --brand:#4f46e5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0d12; --card:#151822; --fg:#e5e7eb; --muted:#9ca3af; --line:#272b36; --brand:#6366f1; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          max-width:520px; width:100%; padding:28px; }
  h1 { font-size:20px; margin:0 0 14px; }
  p { margin:0 0 14px; }
  .muted { color:var(--muted); font-size:14px; }
  .modules { background:var(--bg); border:1px solid var(--line); border-radius:10px;
             padding:12px 14px; font-size:14px; margin:0 0 16px; }
  .who { border-left:3px solid var(--brand); padding:8px 12px; margin:0 0 16px; font-size:14px; }
  .row { display:flex; gap:10px; margin-top:22px; }
  button, .btn { font:inherit; border-radius:9px; padding:11px 18px; cursor:pointer; border:1px solid var(--line); }
  .primary { background:var(--brand); color:#fff; border-color:var(--brand); flex:1; }
  .secondary { background:transparent; color:var(--fg); text-decoration:none; text-align:center; flex:1; }
</style>
</head>
<body><main class="card">${opts.body}</main></body>
</html>`,
    opts.status ?? 200,
  );
}

function errorPage(title: string, message: string, status: number): NextResponse {
  return page({
    title,
    status,
    body: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
  });
}

/**
 * Validate the OAuth parameters.
 *
 * Order matters: client_id and redirect_uri are checked FIRST, because until
 * both are known-good there is nowhere safe to send an error. Only after that
 * may a protocol error be reported back to the client by redirect.
 */
async function validate(url: URL): Promise<ValidationResult> {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";

  if (!clientId) {
    return {
      ok: false,
      page: "This link is missing its client_id, so OZZO cannot tell which AI tool is asking.",
    };
  }

  const client = await getClient(clientId);
  if (!client) {
    return {
      ok: false,
      page: "OZZO does not recognise this AI tool. Please remove the connector and add it again.",
    };
  }

  if (!redirectUri || !isRegisteredRedirectUri(redirectUri, client.redirect_uris)) {
    // Deliberately NOT a redirect: honouring an unregistered URI here is the
    // open-redirect bug itself.
    return {
      ok: false,
      page: "This link's return address does not match the one the AI tool registered, so OZZO has stopped. Please remove the connector and add it again.",
    };
  }

  const state = url.searchParams.get("state");
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";

  // From here on the redirect_uri is trusted, so protocol errors go back to
  // the client where its own error handling can show them.
  const redirectErr = (error: string, description: string): ValidationResult => ({
    ok: false,
    redirect: { redirectUri, state, error, description },
  });

  if (responseType !== "code") {
    return redirectErr("unsupported_response_type", "Only the code response type is supported.");
  }
  if (!codeChallenge) {
    return redirectErr("invalid_request", "A PKCE code_challenge is required.");
  }
  if (!isSupportedChallengeMethod(codeChallengeMethod)) {
    return redirectErr(
      "invalid_request",
      "code_challenge_method must be S256; OAuth 2.1 does not allow plain.",
    );
  }

  return {
    ok: true,
    value: {
      clientId,
      clientName: client.client_name,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
    },
  };
}

function redirectWithError(e: RedirectableError): NextResponse {
  const target = new URL(e.redirectUri);
  target.searchParams.set("error", e.error);
  target.searchParams.set("error_description", e.description);
  if (e.state) target.searchParams.set("state", e.state);
  return NextResponse.redirect(target.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

interface AdminIdentity {
  profileId: string;
  accountId: string;
  accountName: string;
  email: string;
  tenant: TenantContext;
  refreshToken: string;
}

type IdentityResult =
  | { kind: "ok"; identity: AdminIdentity }
  | { kind: "signed_out" }
  | { kind: "not_admin" }
  | { kind: "no_account" };

/** Who is signed in, and are they allowed to do this. */
async function loadAdmin(): Promise<IdentityResult> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user || !session.refresh_token) return { kind: "signed_out" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, account_id, account_role, email")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!profile) return { kind: "no_account" };

  const row = profile as {
    id: string;
    account_id: string | null;
    account_role: string | null;
    email: string | null;
  };
  if (!row.account_id) return { kind: "no_account" };
  if (!ADMIN_ROLES.has(String(row.account_role ?? "").toLowerCase())) {
    return { kind: "not_admin" };
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, subscription_plan, module_settings, settings")
    .eq("id", row.account_id)
    .maybeSingle();
  if (!account) return { kind: "no_account" };

  const acct = account as {
    name: string | null;
    subscription_plan: unknown;
    module_settings: unknown;
    settings: Record<string, unknown> | null;
  };
  const settings = acct.settings ?? {};
  const moduleSettings: Record<string, boolean> = {};
  if (acct.module_settings && typeof acct.module_settings === "object" && !Array.isArray(acct.module_settings)) {
    for (const [k, v] of Object.entries(acct.module_settings as Record<string, unknown>)) {
      if (typeof v === "boolean") moduleSettings[k] = v;
    }
  }

  return {
    kind: "ok",
    identity: {
      profileId: row.id,
      accountId: row.account_id,
      accountName: acct.name ?? "your account",
      email: row.email ?? session.user.email ?? "",
      tenant: {
        plan: acct.subscription_plan,
        moduleSettings,
        allowWorkforceData: settings.mcp_allow_workforce_data === true,
      },
      refreshToken: session.refresh_token,
    },
  };
}

/** "a, b and c" — read aloud by a human, so no Oxford comma salad. */
function listSentence(items: string[]): string {
  if (items.length === 0) return "nothing yet";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function signInRedirect(url: URL): NextResponse {
  const next = `${url.pathname}${url.search}`;
  const target = new URL(url.toString());
  target.pathname = "/login";
  target.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(target.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

function consentScreen(v: ValidatedRequest, admin: AdminIdentity): NextResponse {
  const modules = visibleDataSets(admin.tenant).map((s) => s.title.toLowerCase());
  const tool = escapeHtml(v.clientName);

  return page({
    title: `Connect ${v.clientName}`,
    body: `
<h1>${tool} wants to read your OZZO data</h1>
<p>It will be able to read:</p>
<div class="modules">${escapeHtml(listSentence(modules))}</div>
<p><strong>This data will leave OZZO</strong> and be sent to ${tool}. ${tool} can only read — it cannot add, change or delete anything in OZZO.</p>
<div class="who">Connecting as <strong>${escapeHtml(admin.email)}</strong> (Admin) for ${escapeHtml(admin.accountName)}</div>
<p class="muted">Employee location, attendance and device data is <strong>not</strong> included. Your account owner can switch that on in Settings.</p>
<form method="POST" class="row">
  <input type="hidden" name="client_id" value="${escapeHtml(v.clientId)}">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(v.redirectUri)}">
  <input type="hidden" name="code_challenge" value="${escapeHtml(v.codeChallenge)}">
  <input type="hidden" name="code_challenge_method" value="${escapeHtml(v.codeChallengeMethod)}">
  <input type="hidden" name="response_type" value="code">
  ${v.state ? `<input type="hidden" name="state" value="${escapeHtml(v.state)}">` : ""}
  <a class="btn secondary" href="/dashboard">Cancel</a>
  <button class="primary" type="submit">Allow</button>
</form>`,
  });
}

function refusalFor(kind: IdentityResult["kind"]): NextResponse {
  if (kind === "not_admin") {
    return errorPage(
      "Only an Admin can do this",
      "Only an Admin can connect an AI tool to OZZO. Ask your account owner to do it, or to make you an Admin.",
      403,
    );
  }
  return errorPage(
    "No OZZO account",
    "This sign-in is not attached to an OZZO account, so there is nothing to connect.",
    403,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await validate(url);
  if (!result.ok) {
    if ("redirect" in result) return redirectWithError(result.redirect);
    return errorPage("Cannot connect", result.page, 400);
  }

  const admin = await loadAdmin();
  if (admin.kind === "signed_out") return signInRedirect(url);
  if (admin.kind !== "ok") return refusalFor(admin.kind);

  return consentScreen(result.value, admin.identity);
}

export async function POST(request: Request) {
  const form = await request.formData();
  // Rebuild the parameters as a URL so POST runs through exactly the same
  // validation as GET. Never trust the form round-trip.
  const url = new URL(request.url);
  url.search = "";
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "state",
  ]) {
    const value = form.get(key);
    if (typeof value === "string" && value) url.searchParams.set(key, value);
  }

  const result = await validate(url);
  if (!result.ok) {
    if ("redirect" in result) return redirectWithError(result.redirect);
    return errorPage("Cannot connect", result.page, 400);
  }

  // Re-check the identity and the role; a session can end, or a role change,
  // between rendering the screen and the click.
  const admin = await loadAdmin();
  if (admin.kind === "signed_out") return signInRedirect(url);
  if (admin.kind !== "ok") return refusalFor(admin.kind);

  const v = result.value;
  let code: string;
  try {
    code = await createAuthCode({
      clientId: v.clientId,
      accountId: admin.identity.accountId,
      profileId: admin.identity.profileId,
      redirectUri: v.redirectUri,
      codeChallenge: v.codeChallenge,
      codeChallengeMethod: v.codeChallengeMethod,
      sbRefreshToken: admin.identity.refreshToken,
    });
  } catch (err) {
    console.error("[mcp] could not issue authorization code:", err);
    return errorPage(
      "Something went wrong",
      "OZZO could not complete the connection. Please try again.",
      500,
    );
  }

  const target = new URL(v.redirectUri);
  target.searchParams.set("code", code);
  if (v.state) target.searchParams.set("state", v.state);
  return NextResponse.redirect(target.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

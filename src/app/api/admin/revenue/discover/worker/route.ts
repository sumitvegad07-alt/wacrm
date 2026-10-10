// ============================================================
// Lead Discovery worker — one link in the harvest chain.
//
// It answers before it works. The reply goes out in milliseconds and the
// harvest then runs in `after()`, for as long as the invocation is allowed, so
// whoever asked for it is never left holding the connection open.
//
// No user session reaches here: this is called by the page that started the
// harvest and by the previous link in the chain, both of them server-side. What
// lets a caller in is the single-use token the previous link wrote on the run
// (see discovery-chain.ts) — or CRON_SECRET, if that is ever set, for prodding
// a harvest along by hand.
// ============================================================

import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { issuerBaseUrl } from "@/lib/mcp/oauth/issuer";
import { authorizeWorker, harvestAndHandOn } from "@/lib/revenue/discovery-chain";

export const dynamic = "force-dynamic";

/** Matches the retention job. The harvest budget sits comfortably inside it. */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    runId?: unknown;
    link?: unknown;
    token?: unknown;
  };

  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const token = typeof body.token === "string" ? body.token : "";
  const admin = serviceClient();

  const allowed = await authorizeWorker(admin, runId, token, req.headers.get("authorization"));
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const link = Number.isInteger(body.link) ? (body.link as number) : 0;
  const baseUrl = issuerBaseUrl(req);

  after(() => harvestAndHandOn(baseUrl, runId, link));

  return NextResponse.json({ accepted: true, runId, link });
}

// ============================================================
// Lead Discovery worker — one link in the harvest chain.
//
// It answers before it works. The reply goes out in milliseconds and the
// harvest then runs in `after()`, for as long as the invocation is allowed, so
// whoever asked for it is never left holding the connection open.
//
// No user session reaches here: this is called by the page that started the
// harvest and by the previous link in the chain, both of them server-side. The
// CRON_SECRET bearer is what stands between the founder's Google quota and
// anyone who can guess a URL.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { issuerBaseUrl } from "@/lib/mcp/oauth/issuer";
import { harvestAndHandOn } from "@/lib/revenue/discovery-chain";

export const dynamic = "force-dynamic";

/** Matches the retention job. The harvest budget sits comfortably inside it. */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; link?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const link = Number.isInteger(body.link) ? (body.link as number) : 0;
  const baseUrl = issuerBaseUrl(req);

  after(() => harvestAndHandOn(baseUrl, runId, link));

  return NextResponse.json({ accepted: true, runId, link });
}

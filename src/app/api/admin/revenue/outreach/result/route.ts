// ============================================================
// What happened to the message /next handed out.
//
// The dead-man switch is counted here rather than in the extension, for the
// same reason everything else is: the extension must not be the thing holding
// the brakes. A `logged_out` result pauses immediately — carrying on against a
// restricted session is how a restriction becomes a ban.
//
// Every query here throws on error. The extension retries a 500, so this
// route is written to be safe to run twice for the same result.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { normalisePhone } from "@/lib/revenue/discovery-query";
import { AGENT_TOKEN_HEADER } from "@/lib/revenue/outreach-agents";
import { OUTREACH_TIMEZONE, zonedClock } from "@/lib/revenue/outreach-policy";
import { authenticateAgent, releaseClaim } from "@/lib/revenue/outreach-store";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set([
  "sent",
  "failed",
  "skipped_not_on_whatsapp",
  "skipped_blocked",
  "logged_out",
  "abandoned",
]);

export async function POST(req: NextRequest) {
  const admin = serviceClient();
  const agent = await authenticateAgent(
    admin,
    req.headers.get(AGENT_TOKEN_HEADER),
  );
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const body: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const outcome = String(body.outcome ?? "");
  const recipientId = Number(body.recipientId);

  // Number(null) and Number("") are 0, which is finite but never a real id.
  if (!OUTCOMES.has(outcome) || !Number.isInteger(recipientId) || recipientId <= 0) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }

  const { data: recipient } = await admin
    .from("re_outreach_recipients")
    .select("id, campaign_id, phone, place_id, is_test, status, rendered_text, claimed_by")
    .eq("id", recipientId)
    .maybeSingle()
    .throwOnError();

  if (!recipient) {
    return NextResponse.json({ error: "Unknown recipient" }, { status: 404 });
  }

  if (outcome === "logged_out") {
    // Put the recipient back — it was never attempted. releaseClaim only acts
    // on a row this agent still holds in flight, so a retried or late
    // logged_out cannot requeue a message that has since been sent.
    //
    // This one stays ABOVE the two 409 guards below, unlike `abandoned`, and
    // deliberately so: its job is to pause the campaign and tell the founder
    // WhatsApp is signed out, and that has to work even for a row that was
    // never issued or is no longer ours. A 409 here would swallow the only
    // warning he gets. Do not "tidy" it down to join `abandoned`.
    await releaseClaim(admin, recipientId, agent.id);
    await admin
      .from("re_outreach_campaigns")
      .update({
        status: "paused",
        paused_reason: "WhatsApp Web is not logged in",
      })
      .eq("id", recipient.campaign_id)
      .eq("status", "running")
      .throwOnError();
    return NextResponse.json({ ok: true });
  }

  // /next stamps rendered_text as the last thing it does before handing a send
  // out. A null means this row was never issued, so a result for it is a replay
  // or a bug — and accepting it would write the permanent sent_phones row and
  // lose the prospect for every future campaign. Applies to every outcome after
  // logged_out, not just `sent`: a skip or failure recorded against a row that
  // was never issued is just as wrong, and just as unrecoverable by the founder.
  if (recipient.rendered_text == null) {
    return NextResponse.json(
      { error: "No send was issued for that recipient" },
      { status: 409 },
    );
  }

  // Only the agent holding the claim may report on it. Without this, a sender
  // using a DIFFERENT token can report `sent` for a row the real sender is
  // mid-send on: the row flips to sent, the permanent sent_phones row is
  // written, and the real sender's later `failed` is dropped by the status
  // guard below — so a failure is recorded as a delivered message and that
  // prospect is excluded from every future campaign.
  //
  // It separates tokens, not browsers. The same token in two Chrome profiles
  // produces claimed_by === agent.id on both and passes this check; what keeps
  // that case safe is the claim itself plus the duplicate guard in /next, and
  // the reason the README says not to do it is the spacing, not this.
  //
  // A row already `sent` is let through, because the retry path below is
  // allowed to complete a partially written record.
  if (recipient.status !== "sent" && recipient.claimed_by !== agent.id) {
    return NextResponse.json(
      { error: "That recipient is claimed by another sender" },
      { status: 409 },
    );
  }

  // The sender stopped before the message went out. Nothing was attempted, so
  // put the recipient back and leave the campaign alone - Stop is a local
  // decision in the extension and says nothing about whether the campaign
  // should still be running.
  //
  // Without this the row sat in_flight until the 15-minute sweep, and /next
  // then marked it "Possible duplicate: a send was issued but never
  // confirmed" - burning a prospect who was never messaged, and feeding the
  // three-strike pause with a failure that never happened.
  //
  // Placed AFTER both guards above, not before them. releaseClaim is itself
  // scoped to status='in_flight' AND claimed_by, so an early branch was safe
  // today - but it made a replay, a late report for a message that did go out,
  // and another sender's row all return {ok:true} indistinguishably, and it
  // left two bypassed 409s waiting to become real holes the moment anyone
  // loosened releaseClaim. A row the extension got from /next is always
  // stamped and always claimed by it, so nothing legitimate is turned away.
  if (outcome === "abandoned") {
    await releaseClaim(admin, recipientId, agent.id);
    return NextResponse.json({ ok: true });
  }

  const now = new Date();

  // A row already recorded as sent is left alone: a retried `sent` must not
  // move sent_at (it feeds the gap and the daily count), and a late `failed`
  // must not turn a delivered message back into a failure. The permanent
  // record below still runs, so a retry after a partial failure completes it.
  if (recipient.status !== "sent") {
    await admin
      .from("re_outreach_recipients")
      .update({
        status: outcome,
        sent_at: outcome === "sent" ? now.toISOString() : null,
        error: outcome === "failed" ? String(body.error ?? "").slice(0, 500) : null,
      })
      .eq("id", recipientId)
      .throwOnError();
  }

  if (outcome === "sent" && !recipient.is_test) {
    // Permanent, and written only on a confirmed send: a number recorded here
    // is a number no later campaign will ever message again, so recording a
    // send that did not happen loses a prospect for good.
    await admin
      .from("re_outreach_sent_phones")
      .upsert(
        {
          phone: recipient.phone,
          campaign_id: recipient.campaign_id,
          place_id: recipient.place_id,
        },
        { onConflict: "phone", ignoreDuplicates: true },
      )
      .throwOnError();

    const reportedPhone = normalisePhone(String(body.senderPhone ?? ""));
    const numberChanged =
      reportedPhone !== "" &&
      agent.sender_phone !== null &&
      agent.sender_phone !== reportedPhone;

    // The ramp counts from this number's first ever send. A different number
    // under the same token is a different number as far as WhatsApp is
    // concerned, so its warm-up starts again from day one. Without this, moving
    // from a trial SIM to the business number would hand the business number
    // the full daily cap on its first day.
    if (!agent.sender_first_sent_on || numberChanged) {
      await admin
        .from("re_outreach_agents")
        .update({
          sender_first_sent_on: zonedClock(now, OUTREACH_TIMEZONE).ymd,
          sender_phone: reportedPhone || agent.sender_phone,
        })
        .eq("id", agent.id)
        .throwOnError();
    }
  }

  return NextResponse.json({ ok: true });
}

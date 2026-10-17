// ============================================================
// The one endpoint that may let a message out.
//
// Everything in the spec's "Keeping the number alive" is enforced here:
// suppression, already-sent, the cap, the window, the warm-up, the long break
// and the gap. The extension is told either one finished message or how long
// to sleep, and it holds none of these rules itself — so a bug in the
// extension cannot blast 20,000 messages, and all of this is testable without
// loading one.
//
// Every query here throws on error. A swallowed error in this file reads as
// "not suppressed", "not sent before", "0 sent today": a plausible wrong answer
// that lets a message out. A throw becomes a 500, the extension retries, and
// nothing is sent on a guess.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { normalisePhone } from "@/lib/revenue/discovery-query";
import { AGENT_TOKEN_HEADER } from "@/lib/revenue/outreach-agents";
import {
  OUTREACH_TIMEZONE,
  decide,
  pickVariant,
  renderMessage,
} from "@/lib/revenue/outreach-policy";
import {
  CAMPAIGN_COLUMNS,
  authenticateAgent,
  claimNext,
  readCounters,
  releaseClaim,
  type CampaignRow,
} from "@/lib/revenue/outreach-store";

export const dynamic = "force-dynamic";

/**
 * The spellings a suppression row for this number might have been stored in.
 * The founder's Suppress action writes the normalised form, but the list is
 * shared with other channels, and the eligibility pass at campaign creation
 * normalises what it reads. An exact match on the normalised form alone would
 * miss a row stored as "+91…" or as a bare ten digits.
 */
function suppressionSpellings(phone: string): string[] {
  const spellings = new Set([phone, `+${phone}`]);
  if (phone.startsWith("91") && phone.length === 12) {
    const national = phone.slice(2);
    spellings.add(national);
    spellings.add(`0${national}`);
  }
  return [...spellings];
}

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
  const senderPhone = normalisePhone(String(body.senderPhone ?? ""));
  if (!senderPhone) {
    return NextResponse.json(
      { kind: "paused", reason: "The extension did not say which number it is logged in as" },
      { status: 200 },
    );
  }

  const { data: campaign } = await admin
    .from("re_outreach_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();

  if (!campaign) {
    return NextResponse.json({ kind: "done", reason: "No campaign is running" });
  }
  const row = campaign as unknown as CampaignRow;

  // A number change is not something to carry on through: the warm-up history
  // belongs to the old number and the founder may have switched Chrome
  // profiles by accident.
  //
  // Every status write below is conditional on the campaign still being
  // `running`, so a campaign the founder stopped a moment ago is not flipped
  // to paused or done by a request that read it before he did.
  if (row.sender_phone && row.sender_phone !== senderPhone) {
    await admin
      .from("re_outreach_campaigns")
      .update({
        status: "paused",
        paused_reason: `WhatsApp Web is logged in as ${senderPhone}, but this campaign has been sending from ${row.sender_phone}`,
      })
      .eq("id", row.id)
      .eq("status", "running")
      .throwOnError();
    return NextResponse.json({ kind: "paused", reason: "The sending number changed" });
  }

  const counters = await readCounters(
    admin,
    row.id,
    senderPhone,
    row.failure_streak_reset_at,
  );

  const decision = decide({
    now: new Date(),
    timezone: OUTREACH_TIMEZONE,
    window: {
      windowStart: row.window_start,
      windowEnd: row.window_end,
      weekdaysOnly: row.weekdays_only,
    },
    dailyCap: row.daily_cap,
    sentToday: counters.sentToday,
    firstSentOn: agent.sender_first_sent_on,
    lastSentAt: counters.lastSentAt,
    gapMinSec: row.gap_min_sec,
    gapMaxSec: row.gap_max_sec,
    queuedRemaining: counters.queuedRemaining,
    consecutiveFailures: counters.consecutiveFailures,
  });

  if (decision.kind === "paused") {
    await admin
      .from("re_outreach_campaigns")
      .update({ status: "paused", paused_reason: decision.reason })
      .eq("id", row.id)
      .eq("status", "running")
      .throwOnError();
    return NextResponse.json(decision);
  }

  if (decision.kind === "done") {
    await admin
      .from("re_outreach_campaigns")
      .update({ status: "done" })
      .eq("id", row.id)
      .eq("status", "running")
      .throwOnError();
    return NextResponse.json(decision);
  }

  if (decision.kind === "wait") return NextResponse.json(decision);

  const recipient = await claimNext(admin, row.id, agent.id);
  if (!recipient) {
    // Everything queued is in another agent's hands, or the count was stale.
    return NextResponse.json({
      kind: "wait",
      waitSeconds: 60,
      reason: "Nothing free to claim",
    });
  }

  // From here on the recipient is claimed. Anything that throws must put it
  // back, or it sits in_flight until the stale window passes — and counts as a
  // message in flight for the gap in the meantime.
  try {
    // Suppression is re-checked HERE, not at campaign creation, so a number the
    // founder suppressed an hour ago is spared even though it was eligible when
    // the campaign was built. Test rows skip it: they are his own numbers.
    if (!recipient.is_test) {
      // A list, not maybeSingle(): one number suppressed under two channels
      // matches two rows, and maybeSingle() errors on more than one.
      const [suppressed, alreadySent] = await Promise.all([
        admin
          .from("re_suppressions")
          .select("value")
          .in("channel", ["whatsapp", "phone", "all"])
          .in("value", suppressionSpellings(recipient.phone))
          .limit(1)
          .throwOnError(),
        admin
          .from("re_outreach_sent_phones")
          .select("phone")
          .eq("phone", recipient.phone)
          .limit(1)
          .throwOnError(),
      ]);

      const isSuppressed = (suppressed.data ?? []).length > 0;
      const wasSent = (alreadySent.data ?? []).length > 0;

      if (isSuppressed || wasSent) {
        await admin
          .from("re_outreach_recipients")
          .update({
            status: isSuppressed ? "skipped_suppressed" : "skipped_already_sent",
            claimed_by: null,
          })
          .eq("id", recipient.id)
          .eq("status", "in_flight")
          .eq("claimed_by", agent.id)
          .throwOnError();
        // Answer immediately rather than sleeping: a skip costs nothing and the
        // extension should get to a real recipient on its next call.
        return NextResponse.json({ kind: "wait", waitSeconds: 1, reason: "Skipped" });
      }
    }

    const variantIndex = pickVariant(recipient.id, row.variants.length);
    const text = renderMessage(row.variants[variantIndex], {
      name: recipient.name,
      city: recipient.city,
      industry: recipient.industry,
    });

    // A campaign that promises an attachment must not go out without one, so a
    // failure to sign the URL stops the send rather than dropping the file.
    let attachmentUrl: string | null = null;
    if (row.attachment_path) {
      const { data: signed, error: signError } = await admin.storage
        .from("outreach")
        .createSignedUrl(row.attachment_path, 600);
      if (signError || !signed?.signedUrl) {
        throw signError ?? new Error("Could not sign the attachment URL");
      }
      attachmentUrl = signed.signedUrl;
    }

    // If we cannot record what we are about to send, do not send it: an
    // unrecorded send is one we cannot prove or deduplicate later. The throw
    // lands in the catch below, which releases the claim.
    await admin
      .from("re_outreach_recipients")
      .update({ variant_index: variantIndex, rendered_text: text })
      .eq("id", recipient.id)
      .throwOnError();

    // `is null` so two agents racing on a fresh campaign cannot overwrite each
    // other's number.
    if (!row.sender_phone) {
      await admin
        .from("re_outreach_campaigns")
        .update({ sender_phone: senderPhone })
        .eq("id", row.id)
        .is("sender_phone", null)
        .throwOnError();
    }

    return NextResponse.json({
      kind: "send",
      recipientId: recipient.id,
      phone: recipient.phone,
      text,
      attachmentUrl,
      isTest: recipient.is_test,
    });
  } catch (err) {
    // Best effort: if the release itself fails, the stale-claim sweep in
    // re_outreach_claim_next recovers the row. The original error is the one
    // worth surfacing.
    await releaseClaim(admin, recipient.id, agent.id).catch(() => {});
    throw err;
  }
}

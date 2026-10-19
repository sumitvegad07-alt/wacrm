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
  MAX_POLL_WAIT_SEC,
  OUTREACH_TIMEZONE,
  decide,
  pickVariant,
  renderMessage,
} from "@/lib/revenue/outreach-policy";
import { suppressionSpellings } from "@/lib/revenue/outreach-eligibility";
import { orderAttachments } from "@/lib/revenue/outreach-attachments";
import {
  CAMPAIGN_COLUMNS,
  authenticateAgent,
  claimNext,
  readCounters,
  releaseClaim,
  type CampaignRow,
} from "@/lib/revenue/outreach-store";

export const dynamic = "force-dynamic";

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
    // The extension reports an empty number only once it has confirmed
    // WhatsApp Web is really logged out, not merely still loading. Writing the
    // reason here is the only way the founder learns why nothing is sending —
    // otherwise the page shows a running campaign and a silent extension.
    //
    // No `.eq("id", ...)` because no campaign has been looked up yet. Matching
    // on `status = running` scopes it to whatever is actually sending; with no
    // number nothing can send, so pausing every running campaign is correct
    // even in the unexpected case of more than one.
    await admin
      .from("re_outreach_campaigns")
      .update({
        status: "paused",
        paused_reason: "WhatsApp Web is not logged in",
      })
      .eq("status", "running")
      .throwOnError();

    return NextResponse.json({
      kind: "paused",
      reason: "WhatsApp Web is not logged in",
    });
  }

  // A test send is the founder checking what a prospect will get, BEFORE he
  // commits to a thousand of them. If only running campaigns were served, the
  // only way to test would be to start the real campaign — so a queued test
  // row is served from a draft or paused campaign too.
  //
  // Only campaigns that can still send are considered: a test row left on a
  // stopped or finished campaign must not be served, nor hold up a later one.
  const { data: live } = await admin
    .from("re_outreach_campaigns")
    .select("id")
    .in("status", ["running", "draft", "paused"])
    .throwOnError();
  const liveIds = (live ?? []).map((c) => c.id as string);

  let pendingTestCampaignId: string | null = null;
  if (liveIds.length > 0) {
    const { data: pendingTest } = await admin
      .from("re_outreach_recipients")
      .select("campaign_id")
      .eq("is_test", true)
      .eq("status", "queued")
      .in("campaign_id", liveIds)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle()
      .throwOnError();
    pendingTestCampaignId = (pendingTest?.campaign_id as string | undefined) ?? null;
  }

  let campaignQuery = admin.from("re_outreach_campaigns").select(CAMPAIGN_COLUMNS);
  campaignQuery = pendingTestCampaignId
    ? campaignQuery.eq("id", pendingTestCampaignId)
    : campaignQuery.eq("status", "running").order("created_at", { ascending: false }).limit(1);
  const { data: campaign } = await campaignQuery.maybeSingle().throwOnError();

  if (!campaign) {
    return NextResponse.json({ kind: "done", reason: "No campaign is running" });
  }
  const row = campaign as unknown as CampaignRow;

  // True when we are here only because a test row is waiting on a draft or
  // paused campaign. Such a campaign may send that test and nothing else.
  const testOnly = row.status !== "running";

  // A number change is not something to carry on through: the warm-up history
  // belongs to the old number and the founder may have switched Chrome
  // profiles by accident.
  //
  // Every status write below is conditional on the campaign still being
  // `running`, so a campaign the founder stopped a moment ago is not flipped
  // to paused or done by a request that read it before he did.
  //
  // Skipped for a test-only campaign (a draft or paused one serving a test
  // row): a test is deliberately sent from whatever number is currently
  // connected, to a number the founder typed in, so there is nothing to
  // protect. Keeping the check there would also wedge the queue, because the
  // test row outranks every other campaign and could never be served.
  if (!testOnly && row.sender_phone && row.sender_phone !== senderPhone) {
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

  // Asked before the claim because decide() runs before it. A queued test row
  // is always claimed first (`order by is_test desc`), so if one exists the
  // next row out is that test. In test-only mode one is known to be waiting.
  let queuedTests = 0;
  if (!testOnly) {
    const { count } = await admin
      .from("re_outreach_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", row.id)
      .eq("is_test", true)
      .eq("status", "queued")
      .throwOnError();
    queuedTests = count ?? 0;
  }

  // The agent remembers the number it last sent from. A different number under
  // the same token has never sent as far as WhatsApp is concerned, so it is
  // judged against day one of the ramp, not the old number's history.
  // /result restarts the stored ramp date once it actually sends.
  const numberIsNew =
    agent.sender_phone !== null && agent.sender_phone !== senderPhone;

  // Kept so it can be re-run after the claim with the bypass withdrawn, once
  // we know whether the row we actually got is the test row.
  const decideInput = {
    now: new Date(),
    timezone: OUTREACH_TIMEZONE,
    window: {
      windowStart: row.window_start,
      windowEnd: row.window_end,
      weekdaysOnly: row.weekdays_only,
    },
    dailyCap: row.daily_cap,
    sentToday: counters.sentToday,
    firstSentOn: numberIsNew ? null : agent.sender_first_sent_on,
    lastSentAt: counters.lastSentAt,
    gapMinSec: row.gap_min_sec,
    gapMaxSec: row.gap_max_sec,
    queuedRemaining: counters.queuedRemaining,
    // The failure streak is about sends to prospects. A test goes to a number
    // the founder typed in himself, and a campaign paused for failures is
    // precisely where he would want to check the message before restarting.
    // Leaving the streak in place here would also wedge the queue: the test
    // row can never be served, and it outranks every other campaign.
    consecutiveFailures: testOnly ? 0 : counters.consecutiveFailures,
    bypassCapAndWindow: testOnly || queuedTests > 0,
  };

  const decision = decide(decideInput);

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

  // A row that was claimed before AND already had a message rendered for it
  // was handed to an extension once. If we are seeing it again, /result never
  // came back within the stale window — so the message may well have gone out
  // and we cannot tell. Resending risks messaging the prospect twice, which is
  // the one failure this design exists to prevent; not sending costs one lead.
  //
  // Deliberately outside the try below: its catch releases the claim, and a
  // release clears the stamp this check reads.
  if (recipient.attempts > 1 && recipient.rendered_text != null) {
    await admin
      .from("re_outreach_recipients")
      .update({
        status: "failed",
        error: "Possible duplicate: a send was issued but never confirmed. Not resent.",
        claimed_by: null,
      })
      .eq("id", recipient.id)
      .eq("status", "in_flight")
      .eq("claimed_by", agent.id)
      .throwOnError();
    return NextResponse.json({
      kind: "wait",
      waitSeconds: 1,
      reason: "Skipped a possible duplicate",
    });
  }

  // skip locked can hand us a real recipient if another request took the test
  // row first. This sits AFTER the duplicate check on purpose: releasing wipes
  // the stamp that check reads, so a real row that may already have been sent
  // must be judged by it first. A draft or paused campaign must never send to a prospect.
  if (testOnly && !recipient.is_test) {
    await releaseClaim(admin, recipient.id, agent.id);
    return NextResponse.json({
      kind: "wait",
      waitSeconds: 5,
      reason: "Waiting for the test message",
    });
  }

  // The same hole, one step further out: on a RUNNING campaign a queued test
  // row also waives the window and the daily cap (`queuedTests > 0` above),
  // and that waiver was granted before the claim. `for update skip locked`
  // means a second concurrent /next skips the test row this one is holding and
  // takes the first real prospect instead — so a cold message could go to a
  // harvested number at 22:00, over the cap, on a day the founder excluded.
  // Two extension installs, or Start pressed while an alarm fires, is enough.
  //
  // Withdraw the bypass and ask again now that the row is known. Anything
  // other than `send` puts the row back and becomes the answer.
  if (!testOnly && queuedTests > 0 && !recipient.is_test) {
    const strict = decide({ ...decideInput, bypassCapAndWindow: false });
    if (strict.kind !== "send") {
      await releaseClaim(admin, recipient.id, agent.id);
      return NextResponse.json(
        strict.kind === "wait"
          ? strict
          : { kind: "wait", waitSeconds: MAX_POLL_WAIT_SEC, reason: strict.reason },
      );
    }
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

    // A campaign that promises attachments must not go out without them, so a
    // failure to sign stops the send rather than quietly dropping a file: half
    // a pitch is worse than a retry, and a retry is what the throw produces.
    //
    // Ten minutes is far longer than a send takes, and the URL is handed to
    // one extension over TLS. Signed per request rather than per campaign so a
    // replaced file is picked up by the next message without a restart.
    const attachments: {
      url: string;
      kind: string;
      fileName: string;
      mimeType: string;
    }[] = [];
    for (const ref of orderAttachments(row.attachments)) {
      const { data: signed, error: signError } = await admin.storage
        .from("outreach")
        .createSignedUrl(ref.path, 600);
      if (signError || !signed?.signedUrl) {
        throw signError ?? new Error("Could not sign the attachment URL");
      }
      attachments.push({
        url: signed.signedUrl,
        kind: ref.kind,
        fileName: ref.fileName,
        // Sent so the extension can rebuild a proper File. A Blob straight
        // from fetch() carries no name, and WhatsApp shows a document's
        // filename to the recipient.
        mimeType: ref.mimeType,
      });
    }

    // `is null` so two agents racing on a fresh campaign cannot overwrite each
    // other's number.
    //
    // NOT for a test row. A test is deliberately sent from whatever number is
    // connected — the spec recommends trying a spare SIM first — so stamping
    // the campaign with it brands the campaign for good: nothing in this
    // codebase ever writes this column back to null, and the mismatch check
    // above then pauses the campaign on every poll once the founder starts it
    // from his real number. The recommended way to use the tool was the way
    // that bricked it.
    if (!row.sender_phone && !recipient.is_test) {
      await admin
        .from("re_outreach_campaigns")
        .update({ sender_phone: senderPhone })
        .eq("id", row.id)
        .is("sender_phone", null)
        .throwOnError();
    }

    // If we cannot record what we are about to send, do not send it: an
    // unrecorded send is one we cannot prove or deduplicate later. The throw
    // lands in the catch below, which releases the claim and clears the stamp.
    //
    // `rendered_text` means "a send was issued for this row", so this is the
    // last write before the response and nothing after it may throw.
    await admin
      .from("re_outreach_recipients")
      .update({ variant_index: variantIndex, rendered_text: text })
      .eq("id", recipient.id)
      // Scoped to this agent's live claim like every other write in this file.
      // This is the stamp the duplicate guard reads, so it is the last one that
      // should go out unguarded: if the 15-minute stale window elapsed during
      // this request and another agent re-claimed the row, this would overwrite
      // that agent's text.
      .eq("status", "in_flight")
      .eq("claimed_by", agent.id)
      .throwOnError();

    return NextResponse.json({
      kind: "send",
      recipientId: recipient.id,
      phone: recipient.phone,
      text,
      // Sent after the text, in this order. An extension too old to know the
      // key ignores it and sends the text alone — degraded, never wrong.
      attachments,
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

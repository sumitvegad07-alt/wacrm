// ============================================================
// The only module that reads or writes outreach rows.
//
// Keeping Supabase out of outreach-policy.ts is what makes the policy
// testable, so the counters it needs are gathered here and handed to it as
// plain numbers.
//
// WHY THE DAY BOUNDARY GOES THROUGH mcp/periods
//
// The cap resets at midnight in India. Doing that in UTC starts the day 5.5
// hours late, which on this codebase is the DSR bug in another costume — see
// the comment on localRangeToUtc. resolvePeriod("today", "Asia/Kolkata")
// gives the local date; localRangeToUtc turns it into the two instants to
// compare sent_at against, with `to` exclusive.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { localRangeToUtc, resolvePeriod } from "@/lib/mcp/periods";
import { hashToken } from "./outreach-agents";
import {
  CLAIM_STALE_MINUTES,
  MAX_CONSECUTIVE_FAILURES,
  OUTREACH_TIMEZONE,
} from "./outreach-policy";

export type Admin = SupabaseClient;

export interface CampaignRow {
  id: string;
  name: string;
  variants: string[];
  attachment_path: string | null;
  status: string;
  daily_cap: number;
  gap_min_sec: number;
  gap_max_sec: number;
  window_start: string;
  window_end: string;
  weekdays_only: boolean;
  paused_reason: string | null;
  sender_phone: string | null;
  failure_streak_reset_at: string;
}

export const CAMPAIGN_COLUMNS =
  "id, name, variants, attachment_path, status, daily_cap, gap_min_sec, gap_max_sec, window_start, window_end, weekdays_only, paused_reason, sender_phone, failure_streak_reset_at";

export interface RecipientRow {
  id: number;
  campaign_id: string;
  phone: string;
  name: string;
  city: string;
  industry: string;
  is_test: boolean;
  place_id: string;
  /** Incremented by every claim, so more than 1 means the row was claimed before. */
  attempts: number;
  /** Non-null means a send was issued for this row. See /next. */
  rendered_text: string | null;
}

export interface AgentRow {
  id: string;
  sender_phone: string | null;
  sender_first_sent_on: string | null;
}

/**
 * Null for a missing, unknown or revoked token. The caller returns 401 and
 * says nothing about which of the three it was.
 */
export async function authenticateAgent(
  admin: Admin,
  token: string | null,
): Promise<AgentRow | null> {
  if (!token) return null;

  const { data } = await admin
    .from("re_outreach_agents")
    .select("id, sender_phone, sender_first_sent_on, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  await admin
    .from("re_outreach_agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    id: data.id,
    sender_phone: data.sender_phone,
    sender_first_sent_on: data.sender_first_sent_on,
  };
}

/**
 * Everything decide() needs, counted at the moment of asking.
 *
 * `sentToday` is counted for the SENDING NUMBER across every campaign, not for
 * this campaign: it is the number that gets banned, so it is the number that
 * carries the cap.
 */
export async function readCounters(
  admin: Admin,
  campaignId: string,
  senderPhone: string,
  failureStreakResetAt: string,
): Promise<{
  sentToday: number;
  lastSentAt: Date | null;
  queuedRemaining: number;
  consecutiveFailures: number;
}> {
  const today = localRangeToUtc(resolvePeriod("today", OUTREACH_TIMEZONE));
  const staleCutoffIso = new Date(
    Date.now() - CLAIM_STALE_MINUTES * 60_000,
  ).toISOString();

  // Every query here throws on error rather than returning null data. The
  // throttle trusts whatever numbers it is handed, so a wrong number is more
  // dangerous than an exception: a swallowed error would read as 0 sent today,
  // no previous send and no failures, and every guard would wave the send
  // through. A throw becomes a 500, the extension retries, and nothing is sent
  // on a guess.
  const senderCampaigns = await admin
    .from("re_outreach_campaigns")
    .select("id")
    .eq("sender_phone", senderPhone)
    .throwOnError();

  const ids = (senderCampaigns.data ?? []).map((row) => row.id as string);
  // A campaign that has not recorded a sender yet is still this one.
  if (!ids.includes(campaignId)) ids.push(campaignId);

  const [sentTodayRes, lastSentRes, inFlightRes, queuedRes, recentRes] =
    await Promise.all([
      admin
        .from("re_outreach_recipients")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", ids)
        .eq("status", "sent")
        .eq("is_test", false)
        .gte("sent_at", today.from)
        .lt("sent_at", today.to)
        .throwOnError(),
      // Postgres sorts NULLs first in a DESC order, so a `sent` row with a null
      // sent_at would win the limit and hide the real last send. Exclude them.
      admin
        .from("re_outreach_recipients")
        .select("sent_at")
        .in("campaign_id", ids)
        .eq("status", "sent")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .throwOnError(),
      // A row claimed but not yet reported is a message that is probably in
      // flight right now. If the gap only counted `sent`, a second /next
      // arriving before the first result lands would see a stale timestamp and
      // release the next recipient immediately — two messages back-to-back,
      // which is the pattern the gap exists to prevent.
      admin
        .from("re_outreach_recipients")
        .select("claimed_at")
        .in("campaign_id", ids)
        .eq("status", "in_flight")
        .gt("claimed_at", staleCutoffIso)
        .order("claimed_at", { ascending: false })
        .limit(1)
        .throwOnError(),
      admin
        .from("re_outreach_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .in("status", ["queued", "in_flight"])
        .throwOnError(),
      // Only `sent` and `failed` count; a skip is not a failure. Read a few more
      // than the threshold so the run of failures can be measured, not guessed.
      //
      // Scoped to after the last resume: the rows that paused this campaign are
      // still here once the founder has fixed whatever broke, and recounting
      // them would re-pause the moment he pressed Start.
      admin
        .from("re_outreach_recipients")
        .select("status")
        .eq("campaign_id", campaignId)
        .in("status", ["sent", "failed"])
        .gt("claimed_at", failureStreakResetAt)
        .order("claimed_at", { ascending: false })
        .limit(MAX_CONSECUTIVE_FAILURES + 1)
        .throwOnError(),
    ]);

  let consecutiveFailures = 0;
  for (const row of recentRes.data ?? []) {
    if (row.status !== "failed") break;
    consecutiveFailures++;
  }

  const lastReported = lastSentRes.data?.[0]?.sent_at
    ? new Date(lastSentRes.data[0].sent_at as string)
    : null;
  const lastClaimed = inFlightRes.data?.[0]?.claimed_at
    ? new Date(inFlightRes.data[0].claimed_at as string)
    : null;
  // Whichever is later: the last reported send or the live claim.
  const lastSentAt =
    lastReported && lastClaimed
      ? lastReported > lastClaimed
        ? lastReported
        : lastClaimed
      : (lastReported ?? lastClaimed);

  return {
    sentToday: sentTodayRes.count ?? 0,
    lastSentAt,
    queuedRemaining: queuedRes.count ?? 0,
    consecutiveFailures,
  };
}

export async function claimNext(
  admin: Admin,
  campaignId: string,
  agentId: string,
): Promise<RecipientRow | null> {
  const staleBefore = new Date(
    Date.now() - CLAIM_STALE_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await admin.rpc("re_outreach_claim_next", {
    p_campaign_id: campaignId,
    p_agent_id: agentId,
    p_stale_before: staleBefore,
  });

  if (error) throw error;

  // PostgREST renders a composite-returning function's empty result as an
  // all-null OBJECT, not as null — verified against production. So `data` is
  // truthy even when nothing was claimed, and `?? null` cannot see it. The
  // caller decides "did I claim anything" from this return value and sends a
  // WhatsApp message if it is non-null, so getting this wrong means sending
  // to a null phone number. Test the primary key, not the object.
  const row = data as RecipientRow | null;
  return row && row.id != null ? row : null;
}

/**
 * Put a claimed row back when the send never happened.
 *
 * Only the agent that holds the claim may release it. If agent A stalls past
 * the stale window, the row is requeued and agent B claims it, then A wakes up
 * and releases: without the claimed_by check that would un-claim B's live
 * send, the row could be claimed a third time, and the prospect would be
 * messaged twice.
 */
export async function releaseClaim(
  admin: Admin,
  recipientId: number,
  agentId: string,
): Promise<void> {
  await admin
    .from("re_outreach_recipients")
    .update({
      status: "queued",
      claimed_by: null,
      claimed_at: null,
      // `rendered_text` means "a send was issued for this row", and /next
      // refuses to re-send a row that carries it. A release means no send
      // happened, so the stamp goes too — otherwise the next claim would take
      // an honest release for a possible duplicate.
      variant_index: null,
      rendered_text: null,
    })
    .eq("id", recipientId)
    .eq("status", "in_flight")
    .eq("claimed_by", agentId)
    .throwOnError();
}

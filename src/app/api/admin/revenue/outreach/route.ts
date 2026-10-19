// ============================================================
// Outreach — founder actions.
//
// One route with an `action` discriminator, following the discover route next
// door. The two the extension calls live in their own files so they cannot
// accidentally inherit requireFounder().
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { normalisePhone } from "@/lib/revenue/discovery-query";
import { mintToken } from "@/lib/revenue/outreach-agents";
import { selectEligible, type DiscoveryLeadRow } from "@/lib/revenue/outreach-eligibility";
import { CAMPAIGN_COLUMNS, type Admin } from "@/lib/revenue/outreach-store";
import { orderAttachments } from "@/lib/revenue/outreach-attachments";
import {
  DEFAULT_DAILY_CAP,
  GAP_CHOICES_MIN,
  MAX_DAILY_CAP,
  gapFromMinutes,
} from "@/lib/revenue/outreach-policy";

export const dynamic = "force-dynamic";

/**
 * A 20,000-recipient campaign is around 40 sequential round trips on top of the
 * paged reads, so the platform default is not enough. The sibling discover
 * route sets the same ceiling.
 */
export const maxDuration = 300;

/**
 * Supabase caps a select at 1,000 rows, whatever `.limit()` says. Everything
 * here that must be complete is therefore read in pages, the way
 * readStoredRows in discovery-runner.ts does it.
 */
const PAGE = 1000;

/**
 * A ceiling on the sent and suppressed lists. These are the opt-out guarantee,
 * so hitting it is an error rather than a quiet truncation: a short list would
 * let people who already got the message, or asked to be left alone, back in.
 */
const MAX_LIST_ROWS = 500_000;

const CAMPAIGN_STATUSES = ["running", "paused", "stopped"] as const;

/** Every status the recipients CHECK constraint allows, for the progress counts. */
const RECIPIENT_STATUSES = [
  "queued",
  "in_flight",
  "sent",
  "failed",
  "skipped_not_on_whatsapp",
  "skipped_blocked",
  "skipped_suppressed",
  "skipped_already_sent",
] as const;

type PageResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;

/**
 * Reads every row a query matches, a page at a time. The query must carry a
 * stable order, or rows can repeat or go missing across pages.
 */
async function readAll<T>(
  page: (from: number, to: number) => PageResult,
  ceiling: number,
  onCeiling: "truncate" | "throw",
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < ceiling; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const got = data ?? [];
    rows.push(...(got as T[]));
    if (got.length < PAGE) return rows;
  }
  if (onCeiling === "throw") {
    throw new Error(`More than ${ceiling} rows; refusing to work from a partial list`);
  }
  return rows;
}

/** The lead rows a selection matches. Read through the service role only. */
async function readLists(admin: Admin) {
  const [sent, suppressed] = await Promise.all([
    readAll<{ phone: string }>(
      (from, to) =>
        admin
          .from("re_outreach_sent_phones")
          .select("phone")
          .order("phone", { ascending: true })
          .range(from, to),
      MAX_LIST_ROWS,
      "throw",
    ),
    readAll<{ value: string }>(
      (from, to) =>
        admin
          .from("re_suppressions")
          .select("value")
          .in("channel", ["whatsapp", "phone", "all"])
          .order("id", { ascending: true })
          .range(from, to),
      MAX_LIST_ROWS,
      "throw",
    ),
  ]);
  return {
    sentPhones: sent.map((r) => r.phone),
    suppressedValues: suppressed.map((r) => r.value),
  };
}

/**
 * Pasted numbers, split into usable phones and the pieces that were refused.
 *
 * Whitespace is deliberately NOT a separator. WhatsApp displays a number as
 * "+91 98765 43210"; splitting on spaces turns that one number into three
 * fragments that normalise to junk, so the real number is never suppressed (or
 * tested) while the response reports success. Numbers are separated by new
 * lines, commas or semicolons only.
 *
 * `rejected` carries the pieces as the founder typed them, so he can see which
 * ones to fix.
 */
function parsePhones(raw: unknown): { phones: string[]; rejected: string[] } {
  const phones: string[] = [];
  const rejected: string[] = [];

  const pieces = String(raw ?? "")
    .split(/[\n,;]+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  for (const piece of pieces) {
    const phone = sendablePhone(piece);
    if (phone) phones.push(phone);
    else rejected.push(piece);
  }

  return { phones, rejected };
}

/**
 * The one place that decides whether a string is a number we will message.
 *
 * Shared by the pasted-numbers box and the CSV upload so the two cannot drift:
 * a rule that lives in two places is a rule that will one day accept a number
 * here and refuse it there, and the founder would have no way to tell which
 * was right.
 *
 * Returns the normalised number, or "" if it is not sendable.
 */
function sendablePhone(piece: string): string {
  // An email must not become a phone number out of whatever digits it holds.
  if (piece.includes("@")) return "";
  const phone = normalisePhone(piece);
  const valid = /^91\d{10}$/.test(phone) || /^(1800|1860|1600)\d{6,8}$/.test(phone);
  return valid ? phone : "";
}

/** How many CSV rows one upload may carry. */
const MAX_CSV_ROWS = 20_000;

/**
 * Turns the rows the upload screen sends into the shape selectEligible wants.
 *
 * The geography columns stay empty: a CSV carries a phone and maybe a name,
 * and every one of those columns on re_outreach_recipients already defaults to
 * ''. Nothing downstream needs them - they were only ever snapshotted from
 * lead discovery so a purge could not break a running campaign - and
 * selectEligible de-duplicates on the normalised phone, not on place_id.
 */
function csvRowsToLeads(raw: unknown): {
  leads: DiscoveryLeadRow[];
  rejected: string[];
} {
  const leads: DiscoveryLeadRow[] = [];
  const rejected: string[] = [];
  if (!Array.isArray(raw)) return { leads, rejected };

  for (const row of raw.slice(0, MAX_CSV_ROWS)) {
    const rawPhone = String((row as Record<string, unknown>)?.phone ?? "").trim();
    if (!rawPhone) continue;

    const phone = sendablePhone(rawPhone);
    if (!phone) {
      // Kept as the founder's file had it, so he can find the row and fix it.
      rejected.push(rawPhone);
      continue;
    }

    leads.push({
      place_id: "",
      phone,
      name: String((row as Record<string, unknown>)?.name ?? "")
        .trim()
        .slice(0, 120),
      city: "",
      district: "",
      state: "",
      industry: "",
    });
  }

  return { leads, rejected };
}

/**
 * The saved wordings, in the order the founder put them in.
 *
 * One library, read the same way by the page and by campaign creation, so what
 * he sees on screen is exactly what a campaign will send. Nothing here filters
 * or re-orders: a campaign that sent a different set from the one displayed
 * would be the whole point of the library undone.
 */
async function readTemplates(admin: Admin): Promise<{ position: number; body: string }[]> {
  const { data } = await admin
    .from("re_outreach_templates")
    .select("position, body")
    .order("position", { ascending: true })
    .throwOnError();
  return (data ?? []) as { position: number; body: string }[];
}

/** The two standing files, slot order, junk rows dropped. */
async function readAttachments(admin: Admin) {
  const { data } = await admin
    .from("re_outreach_attachments")
    .select("slot, path, file_name, mime_type, kind, size_bytes, updated_at")
    .order("slot", { ascending: true })
    .throwOnError();
  return data ?? [];
}

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    const [campaigns, agents, templates, attachments] = await Promise.all([
      admin
        .from("re_outreach_campaigns")
        .select(`${CAMPAIGN_COLUMNS}, created_at` as const)
        .order("created_at", { ascending: false })
        .limit(20)
        .throwOnError(),
      admin
        .from("re_outreach_agents")
        .select("id, label, sender_phone, sender_first_sent_on, last_seen_at, revoked_at")
        .order("created_at", { ascending: false })
        .throwOnError(),
      readTemplates(admin),
      readAttachments(admin),
    ]);

    const active = (campaigns.data ?? []).find(
      (c) => c.status === "running" || c.status === "paused",
    );

    let progress = null;
    if (active) {
      // One head-only count per status, not a fetch of every row: a campaign
      // can hold 20,000 recipients and a select returns at most 1,000 of them.
      const counted = await Promise.all(
        RECIPIENT_STATUSES.map((status) =>
          admin
            .from("re_outreach_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", active.id)
            .eq("status", status)
            .throwOnError(),
        ),
      );
      const counts: Record<string, number> = {};
      RECIPIENT_STATUSES.forEach((status, i) => {
        counts[status] = counted[i].count ?? 0;
      });

      const { data: recent } = await admin
        .from("re_outreach_recipients")
        .select("phone, name, status, error, sent_at")
        .eq("campaign_id", active.id)
        .not("claimed_at", "is", null)
        .order("claimed_at", { ascending: false })
        .limit(10)
        .throwOnError();

      progress = { counts, recent: recent ?? [] };
    }

    return NextResponse.json({
      campaigns: campaigns.data ?? [],
      agents: agents.data ?? [],
      templates,
      attachments,
      progress,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const admin = serviceClient();
    const parsed: unknown = await req.json().catch(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

    switch (body.action) {
      // ── Save the message library ──
      //
      // Replaces it wholesale rather than patching row by row: the page always
      // sends the complete set it is showing, and a partial update would leave
      // a wording the founder deleted still sitting in position 3, sending.
      case "templates.save": {
        if (!Array.isArray(body.templates)) {
          return NextResponse.json(
            { error: "Write between two and four wordings" },
            { status: 400 },
          );
        }
        const bodies: string[] = body.templates
          .filter((v: unknown): v is string => typeof v === "string")
          .map((v: string) => v.trim())
          .filter(Boolean)
          .slice(0, 4);
        if (bodies.length < 2) {
          return NextResponse.json(
            { error: "Write between two and four wordings" },
            { status: 400 },
          );
        }

        // Delete then insert, not an upsert: the count can go down, and the
        // rows for positions that no longer exist have to go with it.
        //
        // A failure between the two leaves the library EMPTY, which stops
        // campaigns starting until he saves again. That is the right way round
        // — the alternative is a half-replaced library sending a wording he
        // thought he had removed.
        await admin
          .from("re_outreach_templates")
          .delete()
          .gte("position", 1)
          .throwOnError();
        await admin
          .from("re_outreach_templates")
          .insert(
            bodies.map((text, i) => ({
              position: i + 1,
              body: text.slice(0, 4000),
              owner_id: ctx.userId,
            })),
          )
          .throwOnError();

        return NextResponse.json({ saved: bodies.length });
      }

      case "create": {
        // WHERE THE WORDINGS COME FROM
        //
        // The saved library, read here rather than taken from the request.
        // The founder's rule is that a campaign may only ever go out in one of
        // his saved wordings; enforcing that in the page alone would leave the
        // endpoint accepting anything, and the endpoint is what actually
        // creates the campaign.
        //
        // Still two to four. Fifty byte-identical messages a day is the
        // pattern spam detection is built to notice, and this is the cheapest
        // protection the tool has after the cap itself.
        const variants: string[] = (await readTemplates(admin)).map((t) => t.body);
        if (variants.length < 2 || variants.length > 4) {
          return NextResponse.json(
            {
              error:
                "Save at least two wordings in your message library before starting a campaign",
            },
            { status: 400 },
          );
        }

        // The column's CHECK still allows up to 500; the application does not.
        // Checked here so a bad value is a readable 400, not a Postgres error
        // behind a 500.
        const dailyCap = Number(body.dailyCap ?? DEFAULT_DAILY_CAP);
        if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > MAX_DAILY_CAP) {
          return NextResponse.json(
            { error: `Daily limit must be a whole number from 1 to ${MAX_DAILY_CAP}` },
            { status: 400 },
          );
        }

        // One of the offered spacings, not a free number. A free field invites
        // "30 seconds", and the gap is the strongest control there is after
        // volume.
        const gapMinutes = Number(body.gapMinutes);
        if (!(GAP_CHOICES_MIN as readonly number[]).includes(gapMinutes)) {
          return NextResponse.json(
            {
              error: `Choose a gap of ${GAP_CHOICES_MIN.join(", ")} minutes`,
            },
            { status: 400 },
          );
        }
        const { gapMinSec, gapMaxSec } = gapFromMinutes(gapMinutes);

        if (!Array.isArray(body.rows) || body.rows.length === 0) {
          return NextResponse.json(
            { error: "Upload a CSV file and choose the column with the phone numbers" },
            { status: 400 },
          );
        }
        if (body.rows.length > MAX_CSV_ROWS) {
          return NextResponse.json(
            {
              error: `That file has ${body.rows.length} rows. The most this will take at once is ${MAX_CSV_ROWS}.`,
            },
            { status: 400 },
          );
        }

        const { leads, rejected } = csvRowsToLeads(body.rows);

        // Suppression and never-message-twice are re-applied here exactly as
        // they were for lead-discovery campaigns. A CSV is a list of strangers
        // the founder typed or exported; it says nothing about who has already
        // been messaged or who replied STOP, and those two promises are not
        // his to break by uploading a file.
        const { sentPhones, suppressedValues } = await readLists(admin);
        const { recipients, funnel } = selectEligible(
          leads,
          sentPhones,
          suppressedValues,
        );

        if (!recipients.length) {
          return NextResponse.json(
            {
              error:
                "Nothing in that file can be messaged. Either the numbers are not valid, or everyone in it has already been messaged or opted out.",
              funnel,
              rejected: rejected.slice(0, 50),
              rejectedCount: rejected.length,
            },
            { status: 400 },
          );
        }

        // Snapshotted, not referenced. A campaign at 50 a day runs for weeks,
        // and replacing the brochure in week two must not silently change what
        // the remaining recipients receive.
        const attachments = orderAttachments(await readAttachments(admin)).map((a) => ({
          slot: a.slot,
          path: a.path,
          file_name: a.fileName,
          mime_type: a.mimeType,
          kind: a.kind,
        }));

        const { data: campaign, error } = await admin
          .from("re_outreach_campaigns")
          .insert({
            name: String(body.name ?? "Untitled campaign").slice(0, 120),
            variants,
            attachments,
            daily_cap: dailyCap,
            gap_min_sec: gapMinSec,
            gap_max_sec: gapMaxSec,
            status: "draft",
            owner_id: ctx.userId,
          })
          .select("id")
          .single();
        if (error) throw error;

        try {
          // Chunked because 20,000 rows in one insert exceeds what PostgREST
          // will accept, and a single unique violation rejects the whole
          // statement - the bug that cost 49 good rows in the leads importer.
          for (let i = 0; i < recipients.length; i += 500) {
            const chunk = recipients.slice(i, i + 500).map((r) => ({
              campaign_id: campaign.id,
              place_id: r.place_id,
              phone: r.phone,
              name: r.name,
              city: r.city,
              district: r.district,
              state: r.state,
              industry: r.industry,
            }));
            const { error: insertError } = await admin
              .from("re_outreach_recipients")
              .upsert(chunk, { onConflict: "campaign_id,phone", ignoreDuplicates: true });
            if (insertError) throw insertError;
          }
        } catch (insertFailure) {
          // Not atomic, so undo by hand. Left behind, this would be a draft
          // campaign with a partial recipient list that looks complete, and
          // pressing Start on it would send to a truncated list unnoticed. The
          // recipients go with it (on delete cascade).
          await admin
            .from("re_outreach_campaigns")
            .delete()
            .eq("id", campaign.id)
            .then(
              () => undefined,
              () => undefined,
            );
          throw insertFailure;
        }

        return NextResponse.json({
          campaignId: campaign.id,
          attachmentCount: attachments.length,
          funnel,
          rejected: rejected.slice(0, 50),
          rejectedCount: rejected.length,
        });
      }

      case "state": {
        const next = String(body.status);
        if (!(CAMPAIGN_STATUSES as readonly string[]).includes(next)) {
          return NextResponse.json({ error: "Unknown state" }, { status: 400 });
        }
        const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
        if (!campaignId) {
          return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
        }

        const { data: current } = await admin
          .from("re_outreach_campaigns")
          .select("id, status")
          .eq("id", campaignId)
          .maybeSingle()
          .throwOnError();
        if (!current) {
          return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        // Which moves are allowed. Stopped and done are terminal. Start only
        // works from draft or paused, so a second click on Start cannot
        // re-stamp failure_streak_reset_at and wipe the failure count.
        const allowedFrom: Record<string, string[]> = {
          running: ["draft", "paused"],
          paused: ["running", "paused"],
          stopped: ["draft", "running", "paused"],
        };
        if (!allowedFrom[next].includes(current.status as string)) {
          return NextResponse.json(
            { error: `A campaign that is ${current.status} cannot be set to ${next}` },
            { status: 409 },
          );
        }

        // One runner at a time. /next serves only the most recently created
        // running campaign, so starting a second one silently starves the
        // first: it keeps showing "running", sends nothing, and never reaches
        // done, because that write is scoped to the campaign /next picked.
        if (next === "running") {
          const { data: alreadyRunning } = await admin
            .from("re_outreach_campaigns")
            .select("id, name")
            .eq("status", "running")
            .neq("id", campaignId)
            .limit(1)
            .maybeSingle()
            .throwOnError();
          if (alreadyRunning) {
            return NextResponse.json(
              {
                error: `"${alreadyRunning.name}" is already running. Pause it before starting another campaign.`,
              },
              { status: 409 },
            );
          }
        }

        const now = new Date().toISOString();
        // Matching on the status just read means two clicks racing each other
        // cannot both pass the check above.
        const { data: changed } = await admin
          .from("re_outreach_campaigns")
          .update({
            status: next,
            // Clearing these on resume matters. The reason, or the page keeps
            // showing why it stopped three days ago; the streak marker, or the
            // failures that paused it are recounted and it pauses again
            // before it sends anything.
            ...(next === "running"
              ? { paused_reason: null, failure_streak_reset_at: now }
              : {}),
            updated_at: now,
          })
          .eq("id", campaignId)
          .eq("status", current.status)
          .select("id")
          .throwOnError();
        if (!changed?.length) {
          return NextResponse.json(
            { error: "The campaign changed while you were doing that. Reload and try again." },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true });
      }

      case "suppress": {
        const { phones, rejected } = parsePhones(body.numbers);
        if (!phones.length) {
          return NextResponse.json(
            { error: "No usable numbers", rejected },
            { status: 400 },
          );
        }
        await admin
          .from("re_suppressions")
          .upsert(
            phones.map((value) => ({
              channel: "whatsapp",
              value,
              reason: "opt_out",
              note: String(body.note ?? ""),
              created_by: ctx.userId,
            })),
            { onConflict: "channel,value", ignoreDuplicates: true },
          )
          .throwOnError();
        return NextResponse.json({ added: phones.length, rejected });
      }

      case "mintAgent": {
        const { token, tokenHash } = mintToken();
        const { data, error } = await admin
          .from("re_outreach_agents")
          .insert({
            label: String(body.label ?? "This computer").slice(0, 60),
            token_hash: tokenHash,
            owner_id: ctx.userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        // The only time the token is ever returned.
        return NextResponse.json({ agentId: data.id, token });
      }

      case "revokeAgent": {
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        if (!agentId) {
          return NextResponse.json({ error: "agentId is required" }, { status: 400 });
        }
        // throwOnError: telling the founder a leaked token is dead when the
        // write failed is worse than a 500. The is-null match keeps a second
        // revoke from overwriting the original timestamp.
        await admin
          .from("re_outreach_agents")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", agentId)
          .is("revoked_at", null)
          .throwOnError();
        return NextResponse.json({ ok: true });
      }

      case "testSend": {
        const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
        if (!campaignId) {
          return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
        }
        const parsedPhones = parsePhones(body.numbers);
        const phones = parsedPhones.phones.slice(0, 3);
        // Anything past the third is not queued, so say so rather than hide it.
        const rejected = [
          ...parsedPhones.rejected,
          ...parsedPhones.phones.slice(3).map((p) => `${p} (only three test numbers at a time)`),
        ];
        if (!phones.length) {
          return NextResponse.json(
            { error: "No usable numbers", rejected },
            { status: 400 },
          );
        }
        // `ignoreDuplicates` means a number already on this campaign inserts
        // nothing. Selecting back returns only the rows actually inserted, so
        // the founder is told which numbers did NOT get a test queued instead
        // of being told they all did.
        const { data: inserted } = await admin
          .from("re_outreach_recipients")
          .upsert(
            phones.map((phone) => ({
              campaign_id: campaignId,
              phone,
              name: "Test",
              is_test: true,
            })),
            { onConflict: "campaign_id,phone", ignoreDuplicates: true },
          )
          .select("phone")
          .throwOnError();

        const insertedPhones = new Set((inserted ?? []).map((r) => r.phone as string));
        const alreadyQueued = phones.filter((p) => !insertedPhones.has(p));

        return NextResponse.json({
          queued: insertedPhones.size,
          rejected,
          alreadyQueued,
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

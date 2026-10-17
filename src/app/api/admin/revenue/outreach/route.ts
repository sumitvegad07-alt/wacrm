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
import { DEFAULT_DAILY_CAP } from "@/lib/revenue/outreach-policy";

export const dynamic = "force-dynamic";

interface Filters {
  runId?: string;
  states?: string[];
  districts?: string[];
  industries?: string[];
}

/** The lead rows a selection matches. Read through the service role only. */
async function readLeads(admin: Admin, filters: Filters): Promise<DiscoveryLeadRow[]> {
  let query = admin
    .from("re_discovery_leads")
    .select("place_id, phone, name, city, district, state, industry")
    .neq("phone", "");

  if (filters.runId) query = query.eq("run_id", filters.runId);
  if (filters.states?.length) query = query.in("state", filters.states);
  if (filters.districts?.length) query = query.in("district", filters.districts);
  if (filters.industries?.length) query = query.in("industry", filters.industries);

  const { data, error } = await query.limit(20_000);
  if (error) throw error;
  return (data ?? []) as DiscoveryLeadRow[];
}

async function readLists(admin: Admin) {
  const [sent, suppressed] = await Promise.all([
    admin.from("re_outreach_sent_phones").select("phone"),
    admin
      .from("re_suppressions")
      .select("value")
      .in("channel", ["whatsapp", "phone", "all"]),
  ]);
  return {
    sentPhones: (sent.data ?? []).map((r) => r.phone as string),
    suppressedValues: (suppressed.data ?? []).map((r) => r.value as string),
  };
}

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    const [campaigns, agents] = await Promise.all([
      admin
        .from("re_outreach_campaigns")
        .select(`${CAMPAIGN_COLUMNS}, created_at` as const)
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("re_outreach_agents")
        .select("id, label, sender_phone, sender_first_sent_on, last_seen_at, revoked_at")
        .order("created_at", { ascending: false }),
    ]);

    const active = (campaigns.data ?? []).find(
      (c) => c.status === "running" || c.status === "paused",
    );

    let progress = null;
    if (active) {
      const { data: rows } = await admin
        .from("re_outreach_recipients")
        .select("status")
        .eq("campaign_id", active.id);

      const counts: Record<string, number> = {};
      for (const row of rows ?? []) {
        counts[row.status as string] = (counts[row.status as string] ?? 0) + 1;
      }

      const { data: recent } = await admin
        .from("re_outreach_recipients")
        .select("phone, name, status, error, sent_at")
        .eq("campaign_id", active.id)
        .not("claimed_at", "is", null)
        .order("claimed_at", { ascending: false })
        .limit(10);

      progress = { counts, recent: recent ?? [] };
    }

    return NextResponse.json({
      campaigns: campaigns.data ?? [],
      agents: agents.data ?? [],
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
    const body = await req.json();

    switch (body.action) {
      case "preview": {
        const leads = await readLeads(admin, body.filters ?? {});
        const { sentPhones, suppressedValues } = await readLists(admin);
        const { funnel } = selectEligible(leads, sentPhones, suppressedValues);
        return NextResponse.json({ funnel });
      }

      case "create": {
        const variants: string[] = (body.variants ?? []).filter(
          (v: string) => typeof v === "string" && v.trim(),
        );
        if (variants.length < 2 || variants.length > 4) {
          return NextResponse.json(
            { error: "Write between two and four wordings" },
            { status: 400 },
          );
        }

        const leads = await readLeads(admin, body.filters ?? {});
        const { sentPhones, suppressedValues } = await readLists(admin);
        const { recipients, funnel } = selectEligible(
          leads,
          sentPhones,
          suppressedValues,
        );

        if (!recipients.length) {
          return NextResponse.json(
            { error: "Nothing left to send to in that selection" },
            { status: 400 },
          );
        }

        const { data: campaign, error } = await admin
          .from("re_outreach_campaigns")
          .insert({
            name: String(body.name ?? "Untitled campaign").slice(0, 120),
            variants,
            attachment_path: body.attachmentPath ?? null,
            daily_cap: Number(body.dailyCap ?? DEFAULT_DAILY_CAP),
            status: "draft",
            owner_id: ctx.userId,
          })
          .select("id")
          .single();
        if (error) throw error;

        // Chunked because 20,000 rows in one insert exceeds what PostgREST
        // will accept, and a single unique violation rejects the whole
        // statement — the bug that cost 49 good rows in the leads importer.
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

        return NextResponse.json({ campaignId: campaign.id, funnel });
      }

      case "state": {
        const next = String(body.status);
        if (!["running", "paused", "stopped"].includes(next)) {
          return NextResponse.json({ error: "Unknown state" }, { status: 400 });
        }
        const now = new Date().toISOString();
        await admin
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
          .eq("id", body.campaignId);
        return NextResponse.json({ ok: true });
      }

      case "suppress": {
        const values: string[] = String(body.numbers ?? "")
          .split(/[\s,;]+/)
          .map(normalisePhone)
          .filter(Boolean);
        if (!values.length) {
          return NextResponse.json({ error: "No usable numbers" }, { status: 400 });
        }
        await admin.from("re_suppressions").upsert(
          values.map((value) => ({
            channel: "whatsapp",
            value,
            reason: "opt_out",
            note: String(body.note ?? ""),
            created_by: ctx.userId,
          })),
          { onConflict: "channel,value", ignoreDuplicates: true },
        );
        return NextResponse.json({ added: values.length });
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
        await admin
          .from("re_outreach_agents")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", body.agentId);
        return NextResponse.json({ ok: true });
      }

      case "testSend": {
        const phones: string[] = String(body.numbers ?? "")
          .split(/[\s,;]+/)
          .map(normalisePhone)
          .filter(Boolean)
          .slice(0, 3);
        if (!phones.length) {
          return NextResponse.json({ error: "No usable numbers" }, { status: 400 });
        }
        await admin.from("re_outreach_recipients").upsert(
          phones.map((phone) => ({
            campaign_id: body.campaignId,
            phone,
            name: "Test",
            is_test: true,
          })),
          { onConflict: "campaign_id,phone", ignoreDuplicates: true },
        );
        return NextResponse.json({ queued: phones.length });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

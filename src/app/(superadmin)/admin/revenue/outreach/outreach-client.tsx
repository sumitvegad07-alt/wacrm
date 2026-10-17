"use client";

// ============================================================
// WhatsApp outreach — founder page.
//
// This page does not send anything. The messages go out from the founder's own
// WhatsApp Web tab, driven by the browser extension; the server decides when
// each one may go. Everything here is a view of that: build a campaign, press
// Start / Pause / Stop, and watch the counts.
//
// Closing this page does NOT stop a campaign. Only Pause and Stop do, or the
// server's own dead-man switch.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Textarea } from "@/components/ui/textarea";
import { listDistricts, listStates } from "@/lib/revenue/discovery-geography";
import { DISCOVERY_INDUSTRIES } from "@/lib/revenue/discovery-taxonomy";

const API = "/api/admin/revenue/outreach";

/** How often the page asks how a running campaign is getting on. */
const POLL_MS = 15_000;

/** The route's own default and the extension's slow-start both assume this. */
const DEFAULT_DAILY_CAP = 80;

const MIN_VARIANTS = 2;
const MAX_VARIANTS = 4;

interface Campaign {
  id: string;
  name: string;
  status: string;
  daily_cap: number;
  paused_reason: string | null;
  sender_phone: string | null;
  created_at: string;
}

interface Agent {
  id: string;
  label: string;
  sender_phone: string | null;
  sender_first_sent_on: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface RecentRow {
  phone: string;
  name: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
}

interface Progress {
  counts: Record<string, number>;
  recent: RecentRow[];
}

interface Funnel {
  matched: number;
  unusablePhone: number;
  duplicate: number;
  alreadySent: number;
  suppressed: number;
  toSend: number;
}

/** What a section says after an action: the outcome, and any pieces refused. */
interface Note {
  tone: "ok" | "error";
  text: string;
  rejected?: string[];
}

type Section = "agents" | "campaign" | "state" | "test" | "suppress";

/** Order and wording for the eight recipient statuses. */
const STATUS_LABELS: Array<[string, string]> = [
  ["queued", "Waiting"],
  ["in_flight", "Sending now"],
  ["sent", "Sent"],
  ["failed", "Failed"],
  ["skipped_not_on_whatsapp", "Not on WhatsApp"],
  ["skipped_blocked", "Blocked"],
  ["skipped_suppressed", "Do not contact"],
  ["skipped_already_sent", "Already messaged"],
];

const STATUS_WORDS: Record<string, string> = Object.fromEntries(STATUS_LABELS);

export default function OutreachClient() {
  const router = useRouter();

  // ── server state ──
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Partial<Record<Section, Note>>>({});

  // ── new campaign form ──
  const [name, setName] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>(["", ""]);
  const [dailyCap, setDailyCap] = useState(String(DEFAULT_DAILY_CAP));
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  // ── other boxes ──
  const [agentLabel, setAgentLabel] = useState("");
  const [minted, setMinted] = useState<{ label: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [testNumbers, setTestNumbers] = useState("");
  const [suppressNumbers, setSuppressNumbers] = useState("");
  const [suppressNote, setSuppressNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stateOptions = useMemo(() => listStates(), []);
  const industryOptions = useMemo(
    () => DISCOVERY_INDUSTRIES.map((i) => ({ value: i.value, label: i.label })),
    [],
  );

  /** Districts of every chosen state, so two states never hide each other's. */
  const districtOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ value: string; label: string }> = [];
    for (const state of states) {
      for (const d of listDistricts(state)) {
        if (seen.has(d.value)) continue;
        seen.add(d.value);
        out.push(d);
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [states]);

  /** Districts of a state that is no longer chosen are dropped at render. */
  const activeDistricts = useMemo(() => {
    const allowed = new Set(districtOptions.map((o) => o.value));
    return districts.filter((d) => allowed.has(d));
  }, [districts, districtOptions]);

  /**
   * `isStale` lets a caller drop an answer that arrives after it stopped caring,
   * the way discover-client's `live` flag does: a slow poll that lands after
   * Pause must not paint "running" over the state the founder just set.
   */
  const load = useCallback(async (isStale?: () => boolean) => {
    try {
      const res = await fetch(API);
      const payload = await res.json().catch(() => null);
      if (isStale?.()) return;
      if (!res.ok || !payload) {
        setLoadError(payload?.error ?? "Could not load the outreach page");
        return;
      }
      setCampaigns(payload.campaigns ?? []);
      setAgents(payload.agents ?? []);
      setProgress(payload.progress ?? null);
      setLoadError(null);
      setNow(Date.now());
    } catch {
      if (isStale?.()) return;
      setLoadError("Could not reach the server");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keeps "last spoke N seconds ago" honest between fetches.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const anyRunning = campaigns.some((c) => c.status === "running");

  // Polling, not a subscription, like Lead Discovery. It runs ONLY while a
  // campaign is running: a paused or stopped one changes only when the founder
  // does something, and he reloads after each action himself.
  useEffect(() => {
    if (!anyRunning) return;

    let live = true;
    let inFlight = false;
    const timer = setInterval(() => {
      // Skip the tick if the last request has not come back, so a slow server
      // is not buried under overlapping polls.
      if (inFlight) return;
      inFlight = true;
      void load(() => !live).finally(() => {
        inFlight = false;
      });
    }, POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [anyRunning, load]);

  /** One request, one outcome. Never throws, so callers only handle results. */
  async function call(body: Record<string, unknown>) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: false, data: { error: "Could not reach the server" } as Record<string, any> };
    }
  }

  function say(section: Section, note: Note | null) {
    setNotes((prev) => ({ ...prev, [section]: note ?? undefined }));
  }

  // ── which campaign the progress and test boxes are about ──
  const openCampaigns = campaigns.filter(
    (c) => c.status === "draft" || c.status === "running" || c.status === "paused",
  );
  const activeCampaign = campaigns.find((c) => c.status === "running" || c.status === "paused");
  const current =
    openCampaigns.find((c) => c.id === selectedId) ?? activeCampaign ?? openCampaigns[0] ?? null;

  // The server counts recipients for one campaign only, the running or paused
  // one. Showing those numbers under a different campaign's name would be wrong.
  const currentProgress = current && activeCampaign && current.id === activeCampaign.id ? progress : null;

  // ── actions ──

  function filters() {
    return {
      ...(states.length ? { states } : {}),
      ...(activeDistricts.length ? { districts: activeDistricts } : {}),
      ...(industries.length ? { industries } : {}),
    };
  }

  async function preview() {
    setBusy("preview");
    say("campaign", null);
    const { ok, data } = await call({ action: "preview", filters: filters() });
    setBusy(null);
    if (!ok) {
      setFunnel(null);
      say("campaign", { tone: "error", text: data.error ?? "Could not preview that selection" });
      return;
    }
    setFunnel(data.funnel ?? null);
  }

  async function create() {
    setBusy("create");
    say("campaign", null);
    const { ok, data } = await call({
      action: "create",
      name: name.trim(),
      variants: variants.map((v) => v.trim()).filter(Boolean),
      dailyCap: Number(dailyCap),
      filters: filters(),
    });
    setBusy(null);
    if (!ok) {
      say("campaign", { tone: "error", text: data.error ?? "Could not create the campaign" });
      return;
    }
    setFunnel(data.funnel ?? null);
    setSelectedId(data.campaignId ?? null);
    setName("");
    setVariants(["", ""]);
    say("campaign", {
      tone: "ok",
      text: `Campaign created with ${fmt(data.funnel?.toSend ?? 0)} people. It is a draft: nothing is sent until you press Start.`,
    });
    await load();
  }

  async function setCampaignState(campaignId: string, status: "running" | "paused" | "stopped") {
    if (
      status === "stopped" &&
      !window.confirm("Stop this campaign for good? A stopped campaign cannot be started again.")
    ) {
      return;
    }
    // Start is the action that begins messaging the whole list from the
    // business number, so it asks like Stop does.
    if (
      status === "running" &&
      !window.confirm(
        "Start sending from this campaign? Messages go out to real prospects.",
      )
    ) {
      return;
    }
    setBusy(status);
    say("state", null);
    const { ok, data } = await call({ action: "state", campaignId, status });
    setBusy(null);
    // A 409 here is the server explaining why the move is not allowed, such as
    // pressing Start twice. It is shown as it came, never swallowed.
    if (!ok) say("state", { tone: "error", text: data.error ?? "Could not change the campaign" });
    await load();
  }

  async function testSend() {
    if (!current) return;
    setBusy("test");
    say("test", null);
    const { ok, data } = await call({
      action: "testSend",
      campaignId: current.id,
      numbers: testNumbers,
    });
    setBusy(null);
    if (!ok) {
      say("test", {
        tone: "error",
        text: data.error ?? "Could not queue the test",
        rejected: data.rejected,
      });
      return;
    }
    const already: string[] = data.alreadyQueued ?? [];
    const queued: number = data.queued ?? 0;
    const alreadyText = already.length
      ? ` ${already.length} already queued on this campaign — each number can be tested once per campaign (${already.join(", ")}).`
      : "";
    say("test", {
      // Nothing queued is not a success, even though the server answered 200.
      tone: queued > 0 ? "ok" : "error",
      text: `${queued} test number${queued === 1 ? "" : "s"} queued on "${current.name}".${alreadyText}`,
      rejected: data.rejected,
    });
    // Only what was refused stays in the box, so he can fix it and press again.
    if (!data.rejected?.length) setTestNumbers("");
    await load();
  }

  async function suppress() {
    setBusy("suppress");
    say("suppress", null);
    const { ok, data } = await call({
      action: "suppress",
      numbers: suppressNumbers,
      note: suppressNote.trim(),
    });
    setBusy(null);
    if (!ok) {
      say("suppress", {
        tone: "error",
        text: data.error ?? "Could not add those numbers",
        rejected: data.rejected,
      });
      return;
    }
    say("suppress", {
      tone: "ok",
      text: `${data.added} number${data.added === 1 ? "" : "s"} added to do-not-contact.`,
      rejected: data.rejected,
    });
    // Whatever was refused stays in the box; everything that went in is cleared.
    setSuppressNumbers(data.rejected?.length ? data.rejected.join("\n") : "");
    setFunnel(null);
  }

  async function mintAgent() {
    setBusy("mint");
    say("agents", null);
    setCopied(false);
    const { ok, data } = await call({ action: "mintAgent", label: agentLabel.trim() });
    setBusy(null);
    if (!ok || !data.token) {
      say("agents", { tone: "error", text: data.error ?? "Could not create a token" });
      return;
    }
    setMinted({ label: agentLabel.trim() || "This computer", token: data.token });
    setAgentLabel("");
    await load();
  }

  async function revokeAgent(agent: Agent) {
    if (
      !window.confirm(
        `Revoke "${agent.label}"? That computer stops working at once and cannot be switched back on.`,
      )
    ) {
      return;
    }
    setBusy(`revoke-${agent.id}`);
    say("agents", null);
    const { ok, data } = await call({ action: "revokeAgent", agentId: agent.id });
    setBusy(null);
    if (!ok) say("agents", { tone: "error", text: data.error ?? "Could not revoke that token" });
    await load();
  }

  async function copyToken() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      // Clipboard blocked: the field is selectable, so he can copy it by hand.
      setCopied(false);
    }
  }

  function setVariant(index: number, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  const filledVariants = variants.filter((v) => v.trim() !== "").length;
  const capNumber = Number(dailyCap);
  const capOk = Number.isInteger(capNumber) && capNumber >= 1 && capNumber <= 500;
  const canCreate =
    name.trim() !== "" && filledVariants >= MIN_VARIANTS && capOk && busy === null;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <button
          onClick={() => router.push("/admin")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 mt-2">
          <MessageSquareText className="h-5 w-5" />
          WhatsApp outreach
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sends your message to the leads from Lead Discovery, one at a time, from your own
          WhatsApp number.
        </p>
      </div>

      {/* ── The standing note ── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <b>Keep WhatsApp Web open in another tab.</b> The messages are sent from that tab. Closing
          this page does <b>not</b> stop a campaign — only Pause or Stop does.
        </span>
      </div>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

      {/* ── 1. Extension status ── */}
      <Panel
        title="Extension"
        hint="Each computer that sends needs its own token. The extension signs in with it."
      >
        {!loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : agents.length === 0 ? (
          // A failed load also leaves this empty; saying "none set up" under the
          // error banner would be wrong.
          loadError ? null : (
            <p className="text-sm text-muted-foreground">
              No extension is set up yet. Make a token below and paste it into the extension.
            </p>
          )
        ) : (
          <ul className="divide-y divide-border">
            {agents.map((agent) => (
              <li key={agent.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm font-medium text-foreground">
                    {agent.label}
                    {agent.revoked_at && (
                      <span className="ml-2 text-xs font-normal text-red-600 dark:text-red-400">
                        Revoked
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {agent.sender_phone
                      ? `Number ${agent.sender_phone}`
                      : "No number yet — it appears after the first message"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{lastSpoke(agent, now)}</p>
                {!agent.revoked_at && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void revokeAgent(agent)}
                  >
                    {busy === `revoke-${agent.id}` ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <X />
                    )}
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="flex-1 min-w-[12rem] space-y-1.5">
            <Label htmlFor="agent-label">Name for this computer</Label>
            <Input
              id="agent-label"
              value={agentLabel}
              onChange={(e) => setAgentLabel(e.target.value)}
              placeholder="e.g. Office laptop"
              maxLength={60}
            />
          </div>
          <Button disabled={busy !== null} onClick={() => void mintAgent()}>
            {busy === "mint" ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Mint token
          </Button>
        </div>

        {minted && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-sm text-foreground">
              <b>Token for &ldquo;{minted.label}&rdquo;.</b> This is the only time you will see
              this. Copy it now and paste it into the extension. If you lose it, revoke it and make
              a new one.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={minted.token}
                aria-label="New token"
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono"
              />
              <Button variant="outline" onClick={() => void copyToken()}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMinted(null);
                  setCopied(false);
                }}
              >
                I have saved it
              </Button>
            </div>
          </div>
        )}
        <NoteView note={notes.agents} />
      </Panel>

      {/* ── 4. Progress (placed high: it is what he returns to) ── */}
      <Panel
        title="Progress"
        hint={
          anyRunning
            ? "Refreshes every 15 seconds while a campaign is running."
            : "Refreshes only while a campaign is running."
        }
      >
        {!loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !current ? (
          loadError ? null : campaigns.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              No campaign is running or waiting. Latest: {campaigns[0].name} (
              {campaigns[0].status}).
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No campaign yet. Build one below, then come back here to start it.
            </p>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {openCampaigns.length > 1 ? (
                <select
                  value={current.id}
                  onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Campaign"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0"
                >
                  {openCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.status})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-semibold text-foreground">{current.name}</p>
              )}
              <span className="text-xs text-muted-foreground">
                {statusWord(current.status)} · up to {current.daily_cap} a day
                {current.sender_phone ? ` · from ${current.sender_phone}` : ""}
              </span>
              <div className="flex gap-2 ml-auto">
                <Button
                  disabled={
                    busy !== null || (current.status !== "draft" && current.status !== "paused")
                  }
                  onClick={() => void setCampaignState(current.id, "running")}
                >
                  {busy === "running" ? <Loader2 className="animate-spin" /> : <Play />}
                  Start
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null || current.status !== "running"}
                  onClick={() => void setCampaignState(current.id, "paused")}
                >
                  {busy === "paused" ? <Loader2 className="animate-spin" /> : <Pause />}
                  Pause
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void setCampaignState(current.id, "stopped")}
                >
                  {busy === "stopped" ? <Loader2 className="animate-spin" /> : <Square />}
                  Stop
                </Button>
              </div>
            </div>

            <NoteView note={notes.state} />

            {/* How the founder learns the dead-man switch fired. */}
            {current.status === "paused" && current.paused_reason && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  <b>Paused: </b>
                  {current.paused_reason}
                </span>
              </div>
            )}
            {current.status === "paused" && !current.paused_reason && (
              <p className="text-sm text-muted-foreground">Paused by you.</p>
            )}

            {currentProgress ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {STATUS_LABELS.map(([key, label]) => (
                    <Stat key={key} label={label} value={fmt(currentProgress.counts[key] ?? 0)} />
                  ))}
                </div>

                <div className="rounded-lg border border-border overflow-hidden">
                  <p className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
                    Last {currentProgress.recent.length || 10} results, newest first
                  </p>
                  {currentProgress.recent.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      Nothing has been tried yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody>
                          {currentProgress.recent.map((row, i) => (
                            <tr key={`${row.phone}-${i}`} className="border-t border-border">
                              <td className="px-4 py-2 text-foreground whitespace-nowrap">
                                {row.name || "—"}
                                <span className="block text-xs text-muted-foreground">
                                  {row.phone}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-foreground whitespace-nowrap">
                                {statusWord(row.status)}
                                {row.error && (
                                  <span className="block text-xs text-red-600 dark:text-red-400 whitespace-normal">
                                    {row.error}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                                {row.sent_at ? whenShort(row.sent_at) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {current.status === "draft"
                  ? "This campaign has not started. Counts appear here once you press Start."
                  : activeCampaign && activeCampaign.id !== current.id
                    ? `Counts are shown only for the running campaign, "${activeCampaign.name}".`
                    : "No counts to show."}
              </p>
            )}
          </>
        )}
      </Panel>

      {/* ── 2. New campaign ── */}
      <Panel
        title="New campaign"
        hint="Pick who to message. Leave a box empty to include everyone."
      >
        <div className="space-y-1.5">
          <Label htmlFor="campaign-name">Campaign name</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Seed dealers, Karnataka"
            maxLength={120}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={`States (${states.length})`}>
            <MultiSelect
              options={stateOptions}
              selectedValues={states}
              onChange={(next) => {
                setStates(next);
                setFunnel(null);
              }}
              searchable
              placeholder="All states"
            />
          </Field>
          <Field label={`Industries (${industries.length})`}>
            <MultiSelect
              options={industryOptions}
              selectedValues={industries}
              onChange={(next) => {
                setIndustries(next);
                setFunnel(null);
              }}
              searchable
              placeholder="All industries"
            />
          </Field>
        </div>

        <Field label={`Districts (${activeDistricts.length} of ${districtOptions.length})`}>
          <MultiSelect
            options={districtOptions}
            selectedValues={activeDistricts}
            onChange={(next) => {
              setDistricts(next);
              setFunnel(null);
            }}
            disabled={states.length === 0}
            searchable
            placeholder={states.length === 0 ? "Pick a state first…" : "All districts"}
          />
        </Field>

        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-2">
          {funnel ? (
            <p className="text-foreground">
              <b>{fmt(funnel.matched)}</b> matched ·{" "}
              {fmt(funnel.unusablePhone)} no usable number · {fmt(funnel.duplicate)} duplicates ·{" "}
              {fmt(funnel.alreadySent)} already messaged · {fmt(funnel.suppressed)} suppressed ·{" "}
              <b>{fmt(funnel.toSend)}</b> to send
            </p>
          ) : (
            <p className="text-muted-foreground">
              Press Preview to see how many people this reaches.
            </p>
          )}
          <Button variant="outline" disabled={busy !== null} onClick={() => void preview()}>
            {busy === "preview" && <Loader2 className="animate-spin" />}
            Preview
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Wordings ({MIN_VARIANTS} to {MAX_VARIANTS})</Label>
            <p className="text-xs text-muted-foreground mt-1.5">
              Each person gets one of these, so the messages are not all identical. You can use{" "}
              <code>{"{name}"}</code>, <code>{"{city}"}</code> and <code>{"{industry}"}</code>; they
              are filled in for each person. The line &ldquo;Reply STOP and I won&apos;t message you
              again.&rdquo; is added to every message automatically.
            </p>
          </div>
          {variants.map((text, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`variant-${i}`} className="text-xs text-muted-foreground">
                  Wording {i + 1}
                </Label>
                {variants.length > MIN_VARIANTS && (
                  <button
                    type="button"
                    onClick={() => setVariants((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              <Textarea
                id={`variant-${i}`}
                value={text}
                onChange={(e) => setVariant(i, e.target.value)}
                placeholder="Hi {name}, …"
                rows={3}
              />
            </div>
          ))}
          {variants.length < MAX_VARIANTS && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVariants((prev) => [...prev, ""])}
            >
              <Plus />
              Add a wording
            </Button>
          )}
        </div>

        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="daily-cap">Messages per day</Label>
          <Input
            id="daily-cap"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            A new number is held below this for its first weeks, whatever you enter.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!canCreate} onClick={() => void create()}>
            {busy === "create" && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </div>
        <NoteView note={notes.campaign} />
      </Panel>

      {/* ── 3. Test send ── */}
      <Panel
        title="Test send"
        hint="These go through the same path as a real send, but skip the cap and the window."
      >
        {current ? (
          <p className="text-xs text-muted-foreground">
            Goes with the campaign &ldquo;{current.name}&rdquo; ({current.status}), so it uses that
            campaign&apos;s wordings. It is sent even before you press Start, and only the test
            numbers are messaged. The extension must be running with WhatsApp Web open.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Create a campaign first.</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="test-numbers">Up to three numbers</Label>
          <Textarea
            id="test-numbers"
            value={testNumbers}
            onChange={(e) => setTestNumbers(e.target.value)}
            placeholder={"+91 98765 43210\n+91 91234 56789"}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Separate numbers with a new line, a comma or a semicolon — not a space, so{" "}
            <code>+91 98765 43210</code> stays one number.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!current || testNumbers.trim() === "" || busy !== null}
          onClick={() => void testSend()}
        >
          {busy === "test" && <Loader2 className="animate-spin" />}
          Send test
        </Button>
        <NoteView note={notes.test} />
      </Panel>

      {/* ── 5. Do not contact ── */}
      <Panel
        title="Do not contact"
        hint="Anyone who replied STOP. Nothing reads replies automatically, so this is the only way they get removed."
      >
        <div className="space-y-1.5">
          <Label htmlFor="suppress-numbers">Numbers to remove</Label>
          <Textarea
            id="suppress-numbers"
            value={suppressNumbers}
            onChange={(e) => setSuppressNumbers(e.target.value)}
            placeholder={"+91 98765 43210\n+91 91234 56789"}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Separate numbers with a new line, a comma or a semicolon — not a space, so{" "}
            <code>+91 98765 43210</code> stays one number. Check WhatsApp for replies regularly and
            paste them here.
          </p>
        </div>
        <div className="space-y-1.5 max-w-md">
          <Label htmlFor="suppress-note">Note (optional)</Label>
          <Input
            id="suppress-note"
            value={suppressNote}
            onChange={(e) => setSuppressNote(e.target.value)}
            placeholder="e.g. Replied STOP on 17 Oct"
          />
        </div>
        <Button
          variant="outline"
          disabled={suppressNumbers.trim() === "" || busy !== null}
          onClick={() => void suppress()}
        >
          {busy === "suppress" && <Loader2 className="animate-spin" />}
          Add to do-not-contact
        </Button>
        <NoteView note={notes.suppress} />
      </Panel>
    </div>
  );
}

/** "1,240" — Indian grouping, like the rest of the revenue tools. */
function fmt(value: number): string {
  return value.toLocaleString("en-IN");
}

function statusWord(status: string): string {
  return STATUS_WORDS[status] ?? status.replace(/_/g, " ");
}

function whenShort(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Last spoke 12 seconds ago", scaled to something readable. */
function lastSpoke(agent: Agent, now: number): string {
  if (agent.revoked_at) return "Switched off";
  if (!agent.last_seen_at) return "Has not spoken yet";
  const seconds = Math.max(0, Math.round((now - new Date(agent.last_seen_at).getTime()) / 1000));
  if (seconds < 90) return `Last spoke ${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `Last spoke ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Last spoke ${hours} hours ago`;
  return `Last spoke ${Math.round(hours / 24)} days ago`;
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** An action's outcome, with the pieces the server refused listed by name. */
function NoteView({ note }: { note?: Note }) {
  if (!note) return null;
  const tone =
    note.tone === "error"
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-700 dark:text-emerald-400";
  return (
    <div className="space-y-1.5 text-sm" role={note.tone === "error" ? "alert" : "status"}>
      <p className={tone}>{note.text}</p>
      {note.rejected && note.rejected.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
          <p className="font-medium">
            {note.rejected.length} could not be used and {note.rejected.length === 1 ? "was" : "were"}{" "}
            NOT used:
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
            {note.rejected.map((piece, i) => (
              <li key={`${piece}-${i}`} className="break-all">
                {piece}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

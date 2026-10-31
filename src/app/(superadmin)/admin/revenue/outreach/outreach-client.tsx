"use client";

/**
 * Upload a CSV, pick the column with the numbers, write the message, send.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The first version of this screen built a campaign out of Lead Discovery:
 * pick a run, pick states, pick districts, pick industries, preview a funnel,
 * then create. The founder used it once end to end and said it was too
 * confusing, so it is gone. Anything he wants to message now arrives as a CSV
 * - Lead Discovery results included, exported first - and there is one path
 * into the sender instead of two.
 *
 * What did NOT get simplified away, because none of it is ceremony:
 *   - two to four wordings, because fifty identical messages a day is the
 *     pattern spam detection looks for
 *   - the suppression list, because it is how a STOP reply is honoured
 *   - a test send, because the first real send should never be the first send
 *   - the sending window, enforced at 10:00-18:30 IST on weekdays and shown
 *     here as text with no control, because business hours look human
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from '@/lib/errors/message';
import {
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_SLOTS,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/revenue/outreach-attachments";
import {
  describeColumns,
  extractRecipients,
  parseCsv,
  type CsvTable,
} from "@/lib/revenue/outreach-csv";

const GAP_CHOICES = [1, 2, 5, 10, 15] as const;
const MAX_DAILY_CAP = 50;

/**
 * The value behind "Don't use a name".
 *
 * An empty string is how the Select says "nothing picked yet", so choosing not
 * to map a name needs a value of its own - otherwise the option cannot be
 * selected and the placeholder never goes away.
 */
const NO_NAME_COLUMN = "none";

/** Mirrors the API's own ceiling so the founder hears about it before uploading. */
const MAX_CSV_ROWS = 20_000;

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  daily_cap: number;
  gap_min_sec: number;
  gap_max_sec: number;
  paused_reason: string | null;
  sender_phone: string | null;
  created_at: string;
}

interface AgentRow {
  id: string;
  label: string;
  sender_phone: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface Progress {
  counts: Record<string, number>;
  recent: {
    phone: string;
    name: string;
    status: string;
    error: string | null;
    sent_at: string | null;
  }[];
}

interface TemplateRow {
  position: number;
  body: string;
}

interface AttachmentRow {
  slot: number;
  path: string;
  file_name: string;
  mime_type: string;
  kind: string;
  size_bytes: number;
  updated_at: string;
}

interface Payload {
  campaigns: CampaignRow[];
  agents: AgentRow[];
  /** The saved wordings. Not part of any campaign, so none can delete them. */
  templates: TemplateRow[];
  /** The two standing files, slot order. */
  attachments: AttachmentRow[];
  progress: Progress | null;
}

const ENDPOINT = "/api/admin/revenue/outreach";
const UPLOAD_ENDPOINT = "/api/admin/revenue/outreach/upload";

/** What the two slots are for, in the order they are sent after the text. */
const SLOT_LABELS: Record<number, string> = {
  1: "Picture",
  2: "PDF",
};

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function callApi<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error ?? `Request failed (${response.status})`);
    Object.assign(error, { payload: data });
    throw error;
  }
  return data as T;
}

function statusWord(status: string): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "queued":
      return "Waiting";
    case "in_flight":
      return "Sending now";
    case "skipped_not_on_whatsapp":
      return "Not on WhatsApp";
    case "skipped_blocked":
      return "Blocked you";
    case "skipped_suppressed":
      return "Opted out";
    case "skipped_already_sent":
      return "Messaged before";
    default:
      return status;
  }
}

export default function OutreachClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");

  // ---- the upload ----
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [phoneColumn, setPhoneColumn] = useState<number | null>(null);
  const [nameColumn, setNameColumn] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- the message library ----
  //
  // `variants` is the DRAFT on screen; the saved library lives on the server.
  // The two are shown side by side so an unsaved edit is visible as one, and a
  // campaign always sends the saved set, never the draft.
  const [variants, setVariants] = useState(["", ""]);
  const librarySeeded = useRef(false);

  // ---- the attachments ----
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const attachmentInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const [gapMinutes, setGapMinutes] = useState<number>(5);
  const [dailyCap, setDailyCap] = useState(String(MAX_DAILY_CAP));

  // ---- the extras ----
  const [newToken, setNewToken] = useState("");
  const [suppressText, setSuppressText] = useState("");
  const [testNumbers, setTestNumbers] = useState("");

  const live = data?.campaigns.find(
    (c) => c.status === "running" || c.status === "paused",
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "Could not load");
      setData(body as Payload);
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error, String(error)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fill the boxes from the saved library the first time it arrives, and never
  // again: the five-second poll below would otherwise wipe whatever he is
  // halfway through typing.
  useEffect(() => {
    if (!data || librarySeeded.current) return;
    librarySeeded.current = true;
    const saved = data.templates.map((t) => t.body);
    setVariants(saved.length >= 2 ? saved : [...saved, "", ""].slice(0, 2));
  }, [data]);

  // Poll only while something is actually moving, so an idle tab is not
  // hitting the production database every five seconds for ever.
  useEffect(() => {
    if (!live || live.status !== "running") return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  const columns = useMemo(
    () => (table ? describeColumns(table, firstRowIsHeader) : []),
    [table, firstRowIsHeader],
  );

  const chosen = useMemo(() => {
    if (!table || phoneColumn === null) return [];
    return extractRecipients(table, firstRowIsHeader, phoneColumn, nameColumn);
  }, [table, firstRowIsHeader, phoneColumn, nameColumn]);

  async function onFile(file: File) {
    setProblem("");
    setNotice("");
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.header.length) {
        setProblem("That file looks empty.");
        return;
      }
      setTable(parsed);
      setFileName(file.name);
      setPhoneColumn(null);
      setNameColumn(null);

      // A guess, not a decision: the founder still has to confirm the column,
      // and the sample value next to it is what tells him whether the guess
      // was right.
      const guess = describeColumns(parsed, true).find(
        (c) =>
          /phone|mobile|contact|number|whatsapp/i.test(c.label) ||
          /^[+ ]?\d[\d\s-]{8,}$/.test(c.sample),
      );
      if (guess) setPhoneColumn(guess.index);
      const nameGuess = describeColumns(parsed, true).find((c) =>
        /name|company|firm|business/i.test(c.label),
      );
      if (nameGuess) setNameColumn(nameGuess.index);
    } catch (error) {
      setProblem(
        `Could not read that file: ${errorMessage(error, String(error))}`,
      );
    }
  }

  function resetUpload() {
    setTable(null);
    setFileName("");
    setPhoneColumn(null);
    setNameColumn(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const filledVariants = variants.map((v) => v.trim()).filter(Boolean);

  /** What a campaign started right now would actually send. */
  const savedVariants = useMemo(
    () => (data?.templates ?? []).map((t) => t.body),
    [data],
  );
  const libraryUnsaved =
    JSON.stringify(filledVariants) !== JSON.stringify(savedVariants);

  const attachments = useMemo(
    () => data?.attachments ?? [],
    [data],
  );
  const attachmentBySlot = useMemo(() => {
    const map: Record<number, AttachmentRow> = {};
    for (const a of attachments) map[a.slot] = a;
    return map;
  }, [attachments]);

  // The SAVED library, not the draft. Pressing send with unsaved edits would
  // otherwise go out in the old wording while the new one sits on screen.
  const canSend =
    !busy &&
    chosen.length > 0 &&
    savedVariants.length >= 2 &&
    !libraryUnsaved &&
    !live;

  async function startSending() {
    if (chosen.length > MAX_CSV_ROWS) {
      setProblem(
        `That file has ${chosen.length.toLocaleString()} numbers. The most this will take at once is ${MAX_CSV_ROWS.toLocaleString()}.`,
      );
      return;
    }
    const fileLine = attachments.length
      ? `\n\nEach person gets the message, then ` +
        attachments.map((a) => a.file_name).join(", then ") +
        "."
      : `\n\nNo files attached — the message goes out on its own.`;
    const ok = window.confirm(
      `Send to ${chosen.length.toLocaleString()} numbers from ${fileName}?\n\n` +
        `These are real WhatsApp messages from whichever number Chrome is signed in as. ` +
        `Up to ${dailyCap} a day, about ${gapMinutes} minute${gapMinutes === 1 ? "" : "s"} apart, 10:00am to 6:30pm on weekdays.` +
        fileLine,
    );
    if (!ok) return;

    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const created = await callApi<{
        campaignId: string;
        attachmentCount: number;
        funnel: Record<string, number>;
        rejected: string[];
        rejectedCount: number;
      }>({
        action: "create",
        name: fileName || "CSV upload",
        rows: chosen,
        // No wordings and no files are sent from here: the server reads both
        // from the saved library, so a campaign can only ever go out in a
        // wording that was saved.
        dailyCap: Number(dailyCap),
        gapMinutes,
      });

      await callApi({
        action: "state",
        campaignId: created.campaignId,
        status: "running",
      });

      const f = created.funnel;
      const skipped: string[] = [];
      if (f.alreadySent) skipped.push(`${f.alreadySent} messaged before`);
      if (f.suppressed) skipped.push(`${f.suppressed} opted out`);
      if (f.duplicate) skipped.push(`${f.duplicate} duplicate`);
      if (created.rejectedCount) skipped.push(`${created.rejectedCount} not valid numbers`);

      setNotice(
        `Started. ${f.toSend.toLocaleString()} will be messaged` +
          (skipped.length ? `; skipped ${skipped.join(", ")}.` : ".") +
          " Keep WhatsApp Web open and press Start sending in the extension.",
      );
      resetUpload();
      await load();
    } catch (error) {
      setProblem(errorMessage(error, String(error)));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Uploads one slot's file.
   *
   * Multipart, through the server, because the bucket is private and has no
   * RLS policies: the service role behind requireFounder() is the only way in.
   */
  async function uploadAttachment(slot: number, file: File) {
    setProblem("");
    setNotice("");
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setProblem("That file is bigger than 16 MB, which is WhatsApp's limit.");
      return;
    }
    setUploadingSlot(slot);
    try {
      const form = new FormData();
      form.append("slot", String(slot));
      form.append("file", file);
      const response = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Upload failed");
      setNotice(`${file.name} saved. Every new campaign will send it.`);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, String(error)));
    } finally {
      setUploadingSlot(null);
      const input = attachmentInputs.current[slot];
      // Cleared so choosing the same file again still fires onChange.
      if (input) input.value = "";
    }
  }

  async function removeAttachment(slot: number) {
    setProblem("");
    setNotice("");
    setUploadingSlot(slot);
    try {
      const response = await fetch(`${UPLOAD_ENDPOINT}?slot=${slot}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not remove it");
      setNotice("Removed. New campaigns will not send it.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, String(error)));
    } finally {
      setUploadingSlot(null);
    }
  }

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      await callApi(body);
      setNotice(success);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, String(error)));
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.progress?.counts ?? {};
  const doneCount = (counts.sent ?? 0) + (counts.failed ?? 0);
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">WhatsApp sender</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV, pick the column with the phone numbers, send. Your wordings and
          your two files are saved here and are the only things that go out.
          Sends 10:00am&ndash;6:30pm, Monday to Friday, up to {MAX_DAILY_CAP} a day.
        </p>
      </header>

      {loadError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {loadError}
        </p>
      ) : null}
      {problem ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm whitespace-pre-wrap">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          {notice}
        </p>
      ) : null}

      {/* ---------------- live campaign ---------------- */}
      {live ? (
        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">
                {live.status === "running" ? "Sending now" : "Paused"}
                {": "}
                {live.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {doneCount.toLocaleString()} of {totalCount.toLocaleString()} done
                {live.sender_phone ? ` · from ${live.sender_phone}` : ""}
                {` · about ${Math.round(live.gap_min_sec / 60)}-${Math.round(
                  live.gap_max_sec / 60,
                )} min apart · ${live.daily_cap}/day`}
              </p>
            </div>
            <div className="flex gap-2">
              {live.status === "running" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "state", campaignId: live.id, status: "paused" },
                      "Paused.",
                    )
                  }
                >
                  Pause
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "state", campaignId: live.id, status: "running" },
                      "Running again.",
                    )
                  }
                >
                  Resume
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Stop this campaign for good? It cannot be resumed."))
                    return;
                  void act(
                    { action: "state", campaignId: live.id, status: "stopped" },
                    "Stopped.",
                  );
                }}
              >
                Stop
              </Button>
            </div>
          </div>

          {live.paused_reason ? (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
              {live.paused_reason}
            </p>
          ) : null}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([status, n]) => (
                <div key={status} className="flex gap-1">
                  <dt className="text-muted-foreground">{statusWord(status)}:</dt>
                  <dd className="font-medium">{n.toLocaleString()}</dd>
                </div>
              ))}
          </dl>

          {data?.progress?.recent?.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {data.progress.recent.map((r) => (
                <li key={`${r.phone}-${r.sent_at ?? ""}`} className="flex gap-2">
                  <span className="font-mono">{r.phone}</span>
                  <span className="text-muted-foreground">{statusWord(r.status)}</span>
                  {r.error ? (
                    <span className="text-muted-foreground">&mdash; {r.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 border-t pt-3">
            <Label htmlFor="test">Send a test to your own number</Label>
            <p className="text-xs text-muted-foreground">
              Up to three numbers. Test messages jump the queue and ignore the daily
              limit, so you can check the wording before the rest go out.
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                id="test"
                value={testNumbers}
                onChange={(e) => setTestNumbers(e.target.value)}
                placeholder="9876543210"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || !testNumbers.trim()}
                onClick={async () => {
                  await act(
                    {
                      action: "testSend",
                      campaignId: live.id,
                      numbers: testNumbers,
                    },
                    "Test queued. It goes out on the extension's next check.",
                  );
                  setTestNumbers("");
                }}
              >
                Send test
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---------------- step 1: the file ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">1. Your list</h2>

        {!table ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              A CSV file with the phone numbers in one of the columns. Indian mobile
              numbers, with or without +91.
            </p>
            {/*
              The input itself is hidden and driven by the button. A bare
              <input type="file"> renders as the browser's own "Choose file / No
              file chosen" text, which in the dark theme was grey on near-black
              and did not read as something you could click at all.
            */}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mt-3 flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/60"
            >
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="text-xs text-muted-foreground">
                Or export one from Lead Discovery and upload it here
              </span>
            </button>
          </>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">{fileName}</span>{" "}
                <span className="text-muted-foreground">
                  &mdash; {table.rows.length.toLocaleString()} rows,{" "}
                  {table.header.length} columns
                </span>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={resetUpload}>
                Choose a different file
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="hasHeader"
                checked={firstRowIsHeader}
                onCheckedChange={(checked) => setFirstRowIsHeader(checked === true)}
              />
              <Label htmlFor="hasHeader" className="text-sm font-normal">
                The first row is a header, not a contact
              </Label>
            </div>

            {/*
              The project's Select, not a native <select>. The native one paints
              its options with the OS list colours, which in the dark theme came
              out as near-invisible grey on grey - and the option text is the
              whole point here, because the sample value next to each column name
              is how you tell you picked the right column.
            */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phoneCol">Which column has the phone numbers?</Label>
                <Select
                  value={phoneColumn === null ? "" : String(phoneColumn)}
                  onValueChange={(v) => setPhoneColumn(v === "" ? null : Number(v))}
                >
                  <SelectTrigger id="phoneCol" className="w-full">
                    <SelectValue placeholder="Choose a column…" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.index} value={String(c.index)}>
                        {c.label}
                        {c.sample ? ` — e.g. ${c.sample}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nameCol">
                  Name column <span className="font-normal">(optional)</span>
                </Label>
                <Select
                  value={nameColumn === null ? NO_NAME_COLUMN : String(nameColumn)}
                  onValueChange={(v) =>
                    setNameColumn(v === NO_NAME_COLUMN || v === "" ? null : Number(v))
                  }
                >
                  <SelectTrigger id="nameCol" className="w-full">
                    <SelectValue placeholder="Don't use a name" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_NAME_COLUMN}>Don&apos;t use a name</SelectItem>
                    {columns.map((c) => (
                      <SelectItem key={c.index} value={String(c.index)}>
                        {c.label}
                        {c.sample ? ` — e.g. ${c.sample}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {phoneColumn !== null ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {chosen.length.toLocaleString()} numbers found in that column
                </p>
                {chosen.length ? (
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {chosen.slice(0, 3).map((r, i) => (
                      <li key={i} className="font-mono text-xs">
                        {r.phone}
                        {r.name ? `  (${r.name})` : ""}
                      </li>
                    ))}
                    {chosen.length > 3 ? (
                      <li className="text-xs">
                        &hellip;and {(chosen.length - 3).toLocaleString()} more
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    That column looks empty. Try another one.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Numbers that aren&apos;t valid, anyone who opted out, and anyone already
                  messaged by an earlier run are removed when you press send. You&apos;ll be
                  told how many.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* ---------------- step 2: the saved wordings ---------------- */}
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">2. Your saved wordings</h2>
          {savedVariants.length ? (
            <span className="text-xs text-muted-foreground">
              {savedVariants.length} saved
              {libraryUnsaved ? " · unsaved changes below" : ""}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          These stay here for good. Finishing, stopping or deleting a campaign does
          not touch them, and every campaign goes out in these wordings only &mdash;
          nothing else can be sent. Write the same message two to four different ways,
          so all {MAX_DAILY_CAP} a day aren&apos;t identical &mdash; that is the main
          thing that gets a number banned. Write{" "}
          <code className="rounded bg-muted px-1">{"{name}"}</code> where the
          person&apos;s name should go. An opt-out line is added automatically.
        </p>

        <div className="mt-3 space-y-3">
          {variants.map((value, i) => (
            <div key={i}>
              <Label htmlFor={`variant-${i}`}>
                Wording {i + 1}
                {i < 2 ? "" : " (optional)"}
              </Label>
              <Textarea
                id={`variant-${i}`}
                rows={3}
                value={value}
                onChange={(e) =>
                  setVariants((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                className="mt-1"
                placeholder={
                  i === 0
                    ? "Hi {name}, I run OZZO — field-sales software for teams like yours. Worth a quick look?"
                    : "Hello {name}, we build OZZO, a field-sales app. Can I send you a 2-minute overview?"
                }
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || filledVariants.length < 2 || !libraryUnsaved}
              onClick={() =>
                act(
                  { action: "templates.save", templates: filledVariants },
                  "Wordings saved. They stay here until you change them.",
                )
              }
            >
              {libraryUnsaved ? "Save wordings" : "Saved"}
            </Button>
            {variants.length < 4 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVariants((prev) => [...prev, ""])}
              >
                Add another wording
              </Button>
            ) : null}
            {libraryUnsaved ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setVariants(
                    savedVariants.length >= 2
                      ? savedVariants
                      : [...savedVariants, "", ""].slice(0, 2),
                  )
                }
              >
                Undo changes
              </Button>
            ) : null}
          </div>
          {libraryUnsaved ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Save these before you start a campaign. Until you do, the wordings above
              are not the ones that would be sent.
            </p>
          ) : null}
        </div>
      </section>

      {/* ---------------- step 3: the attachments ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">3. Files to send with it</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Up to two files, saved here for good like the wordings. Every campaign sends
          them &mdash; the message first, then the picture, then the PDF. A picture
          shows as a photo in the chat; a PDF shows as a file. JPG, PNG, WebP or PDF,
          up to 16 MB each. Leave them empty to send the message on its own.
        </p>

        <div className="mt-3 space-y-3">
          {ATTACHMENT_SLOTS.map((slot) => {
            const current = attachmentBySlot[slot];
            const working = uploadingSlot === slot;
            return (
              <div
                key={slot}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {SLOT_LABELS[slot]}{" "}
                    <span className="font-normal text-muted-foreground">
                      (sent {slot === 1 ? "second" : "third"})
                    </span>
                  </p>
                  {current ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <Paperclip className="mr-1 inline h-3 w-3" />
                      {current.file_name} · {fileSize(current.size_bytes)} ·{" "}
                      {current.kind === "image" ? "photo" : "file"}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Nothing attached
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      attachmentInputs.current[slot] = el;
                    }}
                    id={`attachment-${slot}`}
                    type="file"
                    accept={ACCEPT_ATTRIBUTE}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadAttachment(slot, file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || working}
                    onClick={() => attachmentInputs.current[slot]?.click()}
                  >
                    {working ? "Uploading…" : current ? "Replace" : "Choose file"}
                  </Button>
                  {current ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || working}
                      onClick={() => void removeAttachment(slot)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {attachments.length > 0 && live ? (
          <p className="mt-3 text-xs text-muted-foreground">
            &ldquo;{live.name}&rdquo; is sending the files it was started with. Changing
            them here only affects the next campaign.
          </p>
        ) : null}
      </section>

      {/* ---------------- step 4: the speed ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">4. How fast</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="gap">Gap between messages</Label>
            <Select
              value={String(gapMinutes)}
              onValueChange={(v) => setGapMinutes(Number(v))}
            >
              <SelectTrigger id="gap" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAP_CHOICES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minute{m === 1 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Varied by about a fifth either way, so the timing doesn&apos;t look
              automated.
            </p>
          </div>

          <div>
            <Label htmlFor="cap">Most per day</Label>
            <Input
              id="cap"
              type="number"
              min={1}
              max={MAX_DAILY_CAP}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {MAX_DAILY_CAP} is the limit. A new number starts at 20 on day one and 40
              on day two by itself.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- send ---------------- */}
      <section className="rounded-lg border p-4">
        {live ? (
          <p className="text-sm text-muted-foreground">
            &ldquo;{live.name}&rdquo; is {live.status}. Stop it before starting another
            list.
          </p>
        ) : (
          <>
            <Button
              type="button"
              disabled={!canSend}
              onClick={() => void startSending()}
            >
              {busy ? "Starting…" : `Start sending to ${chosen.length.toLocaleString()}`}
            </Button>
            {!chosen.length ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Upload a file and choose the phone column first.
              </p>
            ) : savedVariants.length < 2 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Save at least two wordings first.
              </p>
            ) : libraryUnsaved ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Save your wordings first, or undo the changes.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ---------------- the extension's token ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">Chrome extension</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The extension does the actual sending through WhatsApp Web. It needs a token
          from here, pasted into its options page once.
        </p>

        {newToken ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium">
              Copy this now &mdash; it is not shown again.
            </p>
            <code className="mt-1 block break-all font-mono text-xs">{newToken}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setNewToken("")}
            >
              Done
            </Button>
          </div>
        ) : null}

        <ul className="mt-3 space-y-1 text-sm">
          {(data?.agents ?? [])
            .filter((a) => !a.revoked_at)
            .map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.label}</span>
                <span className="text-muted-foreground">
                  {a.sender_phone ? `sends from ${a.sender_phone}` : "not used yet"}
                  {a.last_seen_at
                    ? ` · last seen ${new Date(a.last_seen_at).toLocaleString()}`
                    : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Revoke "${a.label}"? The extension stops.`))
                      return;
                    void act({ action: "revokeAgent", agentId: a.id }, "Revoked.");
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem("");
            setNotice("");
            try {
              const made = await callApi<{ token: string }>({
                action: "mintAgent",
                label: `Chrome ${new Date().toLocaleDateString()}`,
              });
              setNewToken(made.token);
              await load();
            } catch (error) {
              setProblem(errorMessage(error, String(error)));
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3"
        >
          Create a token
        </Button>
      </section>

      {/* ---------------- suppression ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">Never message these</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When someone replies STOP, paste their number here. They are skipped by every
          campaign from then on, including lists you upload later. One per line.
        </p>
        <Textarea
          rows={3}
          value={suppressText}
          onChange={(e) => setSuppressText(e.target.value)}
          placeholder={"9876543210\n+91 91234 56789"}
          className="mt-2"
        />
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          disabled={busy || !suppressText.trim()}
          onClick={async () => {
            await act(
              { action: "suppress", numbers: suppressText, note: "Replied STOP" },
              "Added to the never-message list.",
            );
            setSuppressText("");
          }}
        >
          Add
        </Button>
      </section>
    </div>
  );
}

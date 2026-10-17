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
import {
  describeColumns,
  extractRecipients,
  parseCsv,
  type CsvTable,
} from "@/lib/revenue/outreach-csv";

const GAP_CHOICES = [1, 2, 5, 10, 15] as const;
const MAX_DAILY_CAP = 50;

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

interface Payload {
  campaigns: CampaignRow[];
  agents: AgentRow[];
  progress: Progress | null;
}

const ENDPOINT = "/api/admin/revenue/outreach";

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

  // ---- the message ----
  const [variants, setVariants] = useState(["", ""]);
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
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        `Could not read that file: ${error instanceof Error ? error.message : String(error)}`,
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
  const canSend =
    !busy &&
    chosen.length > 0 &&
    filledVariants.length >= 2 &&
    !live;

  async function startSending() {
    if (chosen.length > MAX_CSV_ROWS) {
      setProblem(
        `That file has ${chosen.length.toLocaleString()} numbers. The most this will take at once is ${MAX_CSV_ROWS.toLocaleString()}.`,
      );
      return;
    }
    const ok = window.confirm(
      `Send to ${chosen.length.toLocaleString()} numbers from ${fileName}?\n\n` +
        `These are real WhatsApp messages from whichever number Chrome is signed in as. ` +
        `Up to ${dailyCap} a day, about ${gapMinutes} minute${gapMinutes === 1 ? "" : "s"} apart, 10:00am to 6:30pm on weekdays.`,
    );
    if (!ok) return;

    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const created = await callApi<{
        campaignId: string;
        funnel: Record<string, number>;
        rejected: string[];
        rejectedCount: number;
      }>({
        action: "create",
        name: fileName || "CSV upload",
        rows: chosen,
        variants: filledVariants,
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
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
      setProblem(error instanceof Error ? error.message : String(error));
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
          Upload a CSV, pick the column with the phone numbers, write the message, send.
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "state", campaignId: live.id, status: "paused" },
                      "Paused.",
                    )
                  }
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { action: "state", campaignId: live.id, status: "running" },
                      "Running again.",
                    )
                  }
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Stop this campaign for good? It cannot be resumed."))
                    return;
                  void act(
                    { action: "state", campaignId: live.id, status: "stopped" },
                    "Stopped.",
                  );
                }}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Stop
              </button>
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
            <label className="block text-sm font-medium" htmlFor="test">
              Send a test to your own number
            </label>
            <p className="text-xs text-muted-foreground">
              Up to three numbers. Test messages jump the queue and ignore the daily
              limit, so you can check the wording before the rest go out.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="test"
                value={testNumbers}
                onChange={(e) => setTestNumbers(e.target.value)}
                placeholder="9876543210"
                className="flex-1 rounded-md border px-3 py-1.5 text-sm"
              />
              <button
                type="button"
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
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Send test
              </button>
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
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="mt-3 block w-full text-sm"
            />
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
              <button
                type="button"
                onClick={resetUpload}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Choose a different file
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={firstRowIsHeader}
                onChange={(e) => setFirstRowIsHeader(e.target.checked)}
              />
              The first row is a header, not a contact
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium" htmlFor="phoneCol">
                  Which column has the phone numbers?
                </label>
                <select
                  id="phoneCol"
                  value={phoneColumn ?? ""}
                  onChange={(e) =>
                    setPhoneColumn(e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                >
                  <option value="">Choose a column&hellip;</option>
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                      {c.sample ? ` — e.g. ${c.sample}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium" htmlFor="nameCol">
                  Name column <span className="font-normal">(optional)</span>
                </label>
                <select
                  id="nameCol"
                  value={nameColumn ?? ""}
                  onChange={(e) =>
                    setNameColumn(e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                >
                  <option value="">Don&apos;t use a name</option>
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                      {c.sample ? ` — e.g. ${c.sample}` : ""}
                    </option>
                  ))}
                </select>
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

      {/* ---------------- step 2: the message ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">2. Your message</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Write the same message two different ways, so all {MAX_DAILY_CAP} a day
          aren&apos;t identical &mdash; that is the main thing that gets a number banned.
          Write <code className="rounded bg-muted px-1">{"{name}"}</code> where the
          person&apos;s name should go. An opt-out line is added automatically.
        </p>

        <div className="mt-3 space-y-3">
          {variants.map((value, i) => (
            <div key={i}>
              <label className="block text-sm font-medium" htmlFor={`variant-${i}`}>
                Wording {i + 1}
                {i < 2 ? "" : " (optional)"}
              </label>
              <textarea
                id={`variant-${i}`}
                rows={3}
                value={value}
                onChange={(e) =>
                  setVariants((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                placeholder={
                  i === 0
                    ? "Hi {name}, I run OZZO — field-sales software for teams like yours. Worth a quick look?"
                    : "Hello {name}, we build OZZO, a field-sales app. Can I send you a 2-minute overview?"
                }
              />
            </div>
          ))}
          {variants.length < 4 ? (
            <button
              type="button"
              onClick={() => setVariants((prev) => [...prev, ""])}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Add another wording
            </button>
          ) : null}
        </div>
      </section>

      {/* ---------------- step 3: the speed ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">3. How fast</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="gap">
              Gap between messages
            </label>
            <select
              id="gap"
              value={gapMinutes}
              onChange={(e) => setGapMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
            >
              {GAP_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} minute{m === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Varied by about a fifth either way, so the timing doesn&apos;t look
              automated.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="cap">
              Most per day
            </label>
            <input
              id="cap"
              type="number"
              min={1}
              max={MAX_DAILY_CAP}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
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
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void startSending()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Starting…" : `Start sending to ${chosen.length.toLocaleString()}`}
            </button>
            {!chosen.length ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Upload a file and choose the phone column first.
              </p>
            ) : filledVariants.length < 2 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Write at least two wordings first.
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
            <button
              type="button"
              onClick={() => setNewToken("")}
              className="mt-2 rounded-md border px-2 py-1 text-xs"
            >
              Done
            </button>
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
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Revoke "${a.label}"? The extension stops.`))
                      return;
                    void act({ action: "revokeAgent", agentId: a.id }, "Revoked.");
                  }}
                  className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
        </ul>

        <button
          type="button"
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
              setProblem(error instanceof Error ? error.message : String(error));
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Create a token
        </button>
      </section>

      {/* ---------------- suppression ---------------- */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">Never message these</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When someone replies STOP, paste their number here. They are skipped by every
          campaign from then on, including lists you upload later. One per line.
        </p>
        <textarea
          rows={3}
          value={suppressText}
          onChange={(e) => setSuppressText(e.target.value)}
          placeholder={"9876543210\n+91 91234 56789"}
          className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !suppressText.trim()}
          onClick={async () => {
            await act(
              { action: "suppress", numbers: suppressText, note: "Replied STOP" },
              "Added to the never-message list.",
            );
            setSuppressText("");
          }}
          className="mt-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Add
        </button>
      </section>
    </div>
  );
}

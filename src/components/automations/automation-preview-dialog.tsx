"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Test mode.
//
// Pick a real record and see exactly what would happen — which conditions
// passed, who would be messaged, at which number, and the rendered message.
// Nothing is sent: no Meta call, no inbox row, no delivery record.
//
// This exists because there is no undo on a sent WhatsApp message. Being able
// to check before switching an automation on is the difference between a
// confident release and an apology to a customer.
// ------------------------------------------------------------

interface PreviewRule {
  id: number;
  field: string;
  operator: string;
  value: unknown;
  actual: unknown;
  passed: boolean;
  note?: string;
}

interface PreviewRecipient {
  type: string;
  label: string;
  phone: string;
  reachable: boolean;
  reason?: string;
  warning?: string;
}

interface PreviewResult {
  record_label: string;
  event_label: string;
  conditions: { passed: boolean; expression: string; rules: PreviewRule[] };
  recipients: PreviewRecipient[];
  rendered: { template_name: string; language: string; variables: string[] } | null;
  would_send: boolean;
  blockers: string[];
}

interface RecordOption {
  id: string;
  label: string;
}

export function AutomationPreviewDialog({
  automationId,
  module,
  open,
  onOpenChange,
}: {
  automationId: string;
  module: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [records, setRecords] = useState<RecordOption[]>([]);
  const [recordId, setRecordId] = useState<string>("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent records of the right kind, so the admin picks something real rather
  // than pasting an id.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/automations/preview-records?module=${module}`);
      if (cancelled || !res.ok) return;
      const body = (await res.json()) as { records: RecordOption[] };
      if (!cancelled) setRecords(body.records ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, module]);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/automations/${automationId}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record_id: recordId }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? "Could not run the preview.");
          setResult(null);
          return;
        }
        setResult(body as PreviewResult);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recordId, automationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test this automation</DialogTitle>
          <DialogDescription>
            Pick a real record to see what would happen. Nothing is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Test against</Label>
            <Select value={recordId || undefined} onValueChange={(v) => setRecordId(v ?? "")}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue
                  placeholder={records.length === 0 ? "No records yet" : "Choose a record..."}
                />
              </SelectTrigger>
              <SelectContent>
                {records.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading && (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking…
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {result && !loading && (
            <div className="space-y-4">
              {/* Verdict */}
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
                  result.would_send
                    ? "border-green-500/40 bg-green-500/10 text-green-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300",
                )}
              >
                {result.would_send ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {result.would_send
                      ? "This would send."
                      : "This would not send."}
                  </p>
                  {result.blockers.length > 0 && (
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                      {result.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Conditions */}
              {result.conditions.rules.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-foreground text-sm font-medium">
                    Conditions{" "}
                    <span className="text-muted-foreground font-mono text-xs">
                      {result.conditions.expression}
                    </span>
                  </h3>
                  <div className="border-border divide-border divide-y rounded-md border">
                    {result.conditions.rules.map((r) => (
                      <div key={r.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                        {r.passed ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400" />
                        ) : (
                          <XCircle className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-foreground">
                            {r.field} {r.operator} {formatValue(r.value)}
                          </p>
                          <p className="text-muted-foreground">
                            actual: {formatValue(r.actual)}
                            {r.note ? ` — ${r.note}` : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recipients */}
              <section className="space-y-1.5">
                <h3 className="text-foreground text-sm font-medium">Who would receive it</h3>
                <div className="border-border divide-border divide-y rounded-md border">
                  {result.recipients.length === 0 && (
                    <p className="text-muted-foreground px-3 py-2 text-xs">
                      No recipients configured.
                    </p>
                  )}
                  {result.recipients.map((r) => (
                    <div key={`${r.type}-${r.label}`} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground">{r.label}</span>
                        <span
                          className={cn(
                            "font-mono",
                            r.reachable ? "text-green-400" : "text-muted-foreground",
                          )}
                        >
                          {r.reachable ? r.phone : "unreachable"}
                        </span>
                      </div>
                      {r.reason && <p className="mt-0.5 text-amber-400">{r.reason}</p>}
                      {r.warning && <p className="mt-0.5 text-amber-400">{r.warning}</p>}
                    </div>
                  ))}
                </div>
              </section>

              {/* Rendered message */}
              {result.rendered && (
                <section className="space-y-1.5">
                  <h3 className="text-foreground text-sm font-medium">The message</h3>
                  <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
                    <p className="text-muted-foreground">
                      Template: <span className="text-foreground">{result.rendered.template_name}</span>
                    </p>
                    {result.rendered.variables.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {result.rendered.variables.map((v, i) => (
                          <li key={i} className="text-foreground">
                            <span className="text-muted-foreground font-mono">
                              {`{{${i + 1}}}`}
                            </span>{" "}
                            {v || <span className="text-amber-400">(empty)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

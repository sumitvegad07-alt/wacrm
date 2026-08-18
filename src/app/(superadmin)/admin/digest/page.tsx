"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Loader2, ShieldAlert, AlertTriangle, Info, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DigestSection {
  title: string;
  lines: string[];
  severity: "info" | "warn" | "critical";
}

interface Digest {
  period: string;
  generatedAt: string;
  headline: string;
  sections: DigestSection[];
  quiet: boolean;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  info: "border-border",
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical")
    return <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />;
  if (severity === "warn")
    return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />;
  return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export default function DigestPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/digest?period=${period}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load");
      setDigest(payload);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const copyText = async () => {
    const res = await fetch(`/api/admin/digest?period=${period}&format=text`);
    if (!res.ok) return toast.error("Could not fetch digest");
    await navigator.clipboard.writeText(await res.text());
    toast.success("Digest copied");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            Operations Digest
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            What happened across the platform, summarised.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["daily", "weekly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm capitalize ${
                  period === p
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <Button variant="outline" className="gap-2" onClick={copyText}>
            <Copy className="h-4 w-4" />
            Copy
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !digest ? null : (
        <>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-lg font-semibold">{digest.headline}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Generated {new Date(digest.generatedAt).toLocaleString()} ·{" "}
              {digest.period}
            </p>
          </div>

          {digest.quiet ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing to report for this period. No exports, no suspicious
                access, no stalled queues, no tenants in a critical state.
              </p>
            </div>
          ) : (
            digest.sections.map((s) => (
              <div
                key={s.title}
                className={`rounded-xl border p-5 ${SEVERITY_STYLES[s.severity]}`}
              >
                <h2 className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <SeverityIcon severity={s.severity} />
                  {s.title}
                </h2>
                <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-6">
                  {s.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            ))
          )}

          <p className="text-xs text-muted-foreground">
            To receive this automatically, schedule a request to{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">
              /api/admin/digest?period={period}&amp;format=text
            </code>{" "}
            with an <code className="font-mono">x-cron-secret</code> header
            matching <code className="font-mono">CRON_SECRET</code>. The endpoint
            returns 503 if that variable is unset, so a misconfigured schedule
            fails loudly rather than mailing empty digests.
          </p>
        </>
      )}
    </div>
  );
}

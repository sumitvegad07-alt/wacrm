"use client";

// ============================================================
// Owner-only switch: may an AI tool read employee location, attendance and
// device health?
//
// Kept as its own card rather than another row in Module Settings, because
// this is the one setting on that page about PEOPLE rather than about the
// business, and it is the only one an Admin cannot change.
// ============================================================
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { getMcpWorkforceAccess, setMcpWorkforceAccess } from "@/app/actions/mcp-settings";
import { FALLBACK_BASE_URL, isLocalHost } from "@/lib/mcp/oauth/issuer";
import { errorMessage } from '@/lib/errors/message';

/**
 * The address an AI tool has to be given to connect to this account.
 *
 * The settings card offered a switch about what an AI tool may read and never
 * said where the tool connects, so there was nothing to paste into Claude or
 * ChatGPT and the feature could not be used at all.
 *
 * Read from the browser's own origin, so a self-hosted or differently-named
 * deployment shows its own address rather than ours — except on a local
 * development host, where the production address is the useful answer (nobody
 * can connect an AI tool to someone's laptop).
 */
function connectorUrl(): string {
  if (typeof window === "undefined") return `${FALLBACK_BASE_URL}/api/mcp`;
  const { origin, host } = window.location;
  return `${isLocalHost(host) ? FALLBACK_BASE_URL : origin.replace(/\/+$/, "")}/api/mcp`;
}

export function McpWorkforceAccessCard() {
  const [enabled, setEnabled] = useState(false);
  const [canChange, setCanChange] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // After mount only: the address depends on window.location, and reading it
  // during render would disagree with the server-rendered HTML.
  useEffect(() => {
    setUrl(connectorUrl());
  }, []);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select the link and copy it by hand");
    }
  }

  useEffect(() => {
    let cancelled = false;
    getMcpWorkforceAccess()
      .then((s) => {
        if (cancelled) return;
        setEnabled(s.enabled);
        setCanChange(s.canChange);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this setting.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(next: boolean) {
    setSaving(true);
    setError(null);
    const previous = enabled;
    setEnabled(next); // optimistic
    try {
      await setMcpWorkforceAccess(next);
    } catch (err) {
      setEnabled(previous); // put it back; never leave the UI claiming a save
      setError(
        errorMessage(err, "Could not save that setting."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI tools and employee data</CardTitle>
        <CardDescription>
          Controls what a connected AI tool (Claude, ChatGPT) may read. Your
          customers, orders and payments are always available to it; this
          switch is only about your people.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* The link, first: without it there is nothing to connect. */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Your connection link</p>
          <div className="flex items-center gap-2">
            <code className="bg-muted border-border min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs">
              {url || "…"}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={copyUrl}
              disabled={!url}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Copy this link and add it in your AI tool as a connector (in Claude:
            Settings → Connectors → Add custom connector; in ChatGPT: Settings →
            Connectors). The tool will then ask you to sign in with your OZZO
            email and password, and it only ever sees the data your own login can
            see.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Allow AI tools to read employee location, attendance and device data
            </p>
            <p className="text-sm text-muted-foreground">
              Off by default. When on, your field staff will be asked to accept
              the location policy again the next time they open the app.
            </p>
            {!canChange && (
              <p className="text-sm text-muted-foreground">
                Only the account owner can change this.
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            disabled={!canChange || saving}
            onCheckedChange={onToggle}
            aria-label="Allow AI tools to read employee location, attendance and device data"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

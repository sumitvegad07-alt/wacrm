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
import { getMcpWorkforceAccess, setMcpWorkforceAccess } from "@/app/actions/mcp-settings";

export function McpWorkforceAccessCard() {
  const [enabled, setEnabled] = useState(false);
  const [canChange, setCanChange] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        err instanceof Error ? err.message : "Could not save that setting.",
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
      <CardContent className="space-y-3">
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

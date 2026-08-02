"use client";

// Route Settings — behavior configuration panel (Phase 2a).
// Skip / reason / out-of-sequence / capacity / approval. Access control (who can do what)
// is NOT here — that lives in the granular permission keys (Employee Roles). Saves through
// /api/account/route-settings (admin-gated server route); the UI never writes the table.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Route as RouteIcon } from "lucide-react";

type Enforcement = "warn" | "block";
type ApprovalMode = "none" | "manager" | "admin";

interface RouteSettings {
  execution: {
    skip_allowed: boolean;
    skip_reason_mandatory: boolean;
    out_of_sequence_allowed: boolean;
    allow_complete_with_pending: boolean;
  };
  capacity: { max_customers: number; enforcement: Enforcement };
  validation: { warn_duplicate_name: boolean; warn_schedule_conflict: boolean };
  approval_mode: ApprovalMode;
}

const FALLBACK: RouteSettings = {
  execution: {
    skip_allowed: true,
    skip_reason_mandatory: true,
    out_of_sequence_allowed: true,
    allow_complete_with_pending: false,
  },
  capacity: { max_customers: 50, enforcement: "warn" },
  validation: { warn_duplicate_name: true, warn_schedule_conflict: true },
  approval_mode: "none",
};

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        enabled ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform",
          enabled ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Toggle enabled={enabled} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function RouteSettings() {
  const { canEditSettings, isModuleEnabled } = useAuth();
  const moduleOn = isModuleEnabled("route");

  const [draft, setDraft] = useState<RouteSettings | null>(null);
  const [saved, setSaved] = useState<RouteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/account/route-settings");
        if (!res.ok) throw new Error("Failed to load route settings");
        const json = await res.json();
        const rs = (json.route_settings as RouteSettings) ?? FALLBACK;
        if (active) {
          setSaved(rs);
          setDraft(rs);
        }
      } catch (err) {
        if (active) setLoadError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const patch = useCallback((fn: (d: RouteSettings) => RouteSettings) => {
    setDraft((prev) => (prev ? fn(prev) : prev));
  }, []);

  const isDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/account/route-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      const json = await res.json();
      const rs = json.route_settings as RouteSettings;
      setSaved(rs);
      setDraft(rs);
      setToast({ type: "success", message: "Route settings saved." });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "An error occurred." });
    } finally {
      setSaving(false);
    }
  }, [draft]);

  // ── states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading route settings…
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {loadError ?? "Could not load route settings."}
      </div>
    );
  }

  const ro = !canEditSettings;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Route Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how routes behave during execution and approval. These are behavior rules — who can
          perform each action is set per role in Employee Roles.
        </p>
      </div>

      {!moduleOn && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Route Management is currently <strong>disabled</strong>. These settings take effect once you
          enable it under Module Settings.
        </div>
      )}
      {ro && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Only admins and owners can change route settings. Viewing in read-only mode.
        </div>
      )}
      {toast && (
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm font-medium",
            toast.type === "success"
              ? "border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Execution */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <RouteIcon className="h-4 w-4 text-primary" /> Execution
        </h3>
        <ToggleRow
          label="Allow skipping stops"
          description="Let a salesman mark a stop as skipped instead of visiting it."
          enabled={draft.execution.skip_allowed}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, execution: { ...d.execution, skip_allowed: v } }))}
        />
        <ToggleRow
          label="Require a reason to skip"
          description="A skipped stop must include a reason."
          enabled={draft.execution.skip_reason_mandatory}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, execution: { ...d.execution, skip_reason_mandatory: v } }))}
        />
        <ToggleRow
          label="Allow visiting out of sequence"
          description="Let stops be completed in any order. When off, stops must be done in planned order."
          enabled={draft.execution.out_of_sequence_allowed}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, execution: { ...d.execution, out_of_sequence_allowed: v } }))}
        />
        <ToggleRow
          label="Allow finishing with pending stops"
          description="Let a route be completed while some stops are still pending. When off, all stops must be completed or skipped first."
          enabled={draft.execution.allow_complete_with_pending}
          disabled={ro}
          onChange={(v) =>
            patch((d) => ({ ...d, execution: { ...d.execution, allow_complete_with_pending: v } }))
          }
        />
      </section>

      {/* Capacity */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Capacity</h3>
        <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-foreground">Max customers per route</span>
            <input
              type="number"
              min={1}
              disabled={ro}
              value={draft.capacity.max_customers}
              onChange={(e) =>
                patch((d) => ({
                  ...d,
                  capacity: { ...d.capacity, max_customers: Math.max(1, Number(e.target.value) || 1) },
                }))
              }
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-foreground">When exceeded</span>
            <select
              disabled={ro}
              value={draft.capacity.enforcement}
              onChange={(e) =>
                patch((d) => ({ ...d, capacity: { ...d.capacity, enforcement: e.target.value as Enforcement } }))
              }
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              <option value="warn">Warn only (non-blocking)</option>
              <option value="block">Block adding more customers</option>
            </select>
          </label>
        </div>
      </section>

      {/* Approval */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Approval</h3>
        <label className="block rounded-lg border border-border bg-card p-4">
          <span className="text-sm font-medium text-foreground">Approval required before a route goes active</span>
          <select
            disabled={ro}
            value={draft.approval_mode}
            onChange={(e) => patch((d) => ({ ...d, approval_mode: e.target.value as ApprovalMode }))}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50 sm:max-w-xs"
          >
            <option value="none">None — activates immediately</option>
            <option value="manager">Manager approval (reporting hierarchy)</option>
            <option value="admin">Admin approval</option>
          </select>
        </label>
      </section>

      {/* Validation warnings */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Validation warnings</h3>
        <ToggleRow
          label="Warn on duplicate route name"
          description="Show a non-blocking warning when a route name already exists."
          enabled={draft.validation.warn_duplicate_name}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, validation: { ...d.validation, warn_duplicate_name: v } }))}
        />
        <ToggleRow
          label="Warn on schedule conflicts"
          description="Show a non-blocking warning when planner assignments conflict."
          enabled={draft.validation.warn_schedule_conflict}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, validation: { ...d.validation, warn_schedule_conflict: v } }))}
        />
      </section>

      {canEditSettings && isDirty && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => setDraft(saved)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

// Geo-Fencing Settings — organization-wide control (default OFF).
//
// When enabled, the mobile app blocks a rep from starting/ending a customer
// visit unless they are physically within the chosen radius of the customer's
// saved location. Enforcement also runs at the database (trigger
// enforce_site_visit_geofence) so it cannot be bypassed by editing the app.
//
// Behavior config only. Saved through /api/account/geofence-settings
// (admin-gated server route); the UI never writes the accounts table directly.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { LocateFixed } from "lucide-react";

const ALLOWED_RADII = [50, 100, 250, 500, 1000] as const;
type GeoFenceRadius = (typeof ALLOWED_RADII)[number];

interface GeoFencingSettings {
  enabled: boolean;
  enforce_check_in: boolean;
  enforce_check_out: boolean;
  radius_m: GeoFenceRadius;
}

const FALLBACK: GeoFencingSettings = {
  enabled: false,
  enforce_check_in: true,
  enforce_check_out: false,
  radius_m: 50,
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

export function GeoFencingSettings() {
  const { canEditSettings } = useAuth();

  const [draft, setDraft] = useState<GeoFencingSettings | null>(null);
  const [saved, setSaved] = useState<GeoFencingSettings | null>(null);
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
        const res = await fetch("/api/account/geofence-settings");
        if (!res.ok) throw new Error("Failed to load geo-fencing settings");
        const json = await res.json();
        const gf = (json.geo_fencing as GeoFencingSettings) ?? FALLBACK;
        if (active) {
          setSaved(gf);
          setDraft(gf);
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

  const patch = useCallback((fn: (d: GeoFencingSettings) => GeoFencingSettings) => {
    setDraft((prev) => (prev ? fn(prev) : prev));
  }, []);

  const isDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/account/geofence-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      const json = await res.json();
      const gf = json.geo_fencing as GeoFencingSettings;
      setSaved(gf);
      setDraft(gf);
      setToast({ type: "success", message: "Geo-fencing settings saved." });
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
        Loading geo-fencing settings…
      </div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {loadError ?? "Could not load geo-fencing settings."}
      </div>
    );
  }

  const ro = !canEditSettings;
  const noEnforcement = draft.enabled && !draft.enforce_check_in && !draft.enforce_check_out;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Geo-Fencing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Require field reps to be physically at the customer&apos;s saved location before they can start
          or finish a visit. Make sure your customers are location-tagged before turning this on.
        </p>
      </div>

      {ro && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Only admins and owners can change geo-fencing. Viewing in read-only mode.
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

      {/* Master switch */}
      <section className="space-y-3">
        <ToggleRow
          label="Enable Geo-Fencing"
          description="When on, reps are blocked from checking in/out beyond the allowed distance from the customer."
          enabled={draft.enabled}
          disabled={ro}
          onChange={(v) => patch((d) => ({ ...d, enabled: v }))}
        />
      </section>

      {/* Sub-settings — only meaningful when enabled */}
      {draft.enabled && (
        <>
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <LocateFixed className="h-4 w-4 text-primary" /> Where to enforce
            </h3>
            <ToggleRow
              label="Fence check-in"
              description="Block starting a visit unless the rep is within range of the customer."
              enabled={draft.enforce_check_in}
              disabled={ro}
              onChange={(v) => patch((d) => ({ ...d, enforce_check_in: v }))}
            />
            <ToggleRow
              label="Fence check-out"
              description="Block finishing a visit unless the rep is still within range of the customer."
              enabled={draft.enforce_check_out}
              disabled={ro}
              onChange={(v) => patch((d) => ({ ...d, enforce_check_out: v }))}
            />
            {noEnforcement && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
                Geo-fencing is on but neither check-in nor check-out is being enforced — turn on at least
                one, otherwise nothing is blocked.
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Allowed radius</h3>
            <label className="block rounded-lg border border-border bg-card p-4">
              <span className="text-sm font-medium text-foreground">
                How close the rep must be to the customer
              </span>
              <select
                disabled={ro}
                value={draft.radius_m}
                onChange={(e) => patch((d) => ({ ...d, radius_m: Number(e.target.value) as GeoFenceRadius }))}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50 sm:max-w-xs"
              >
                {ALLOWED_RADII.map((r) => (
                  <option key={r} value={r}>
                    {r >= 1000 ? `${r / 1000} km (${r} m)` : `${r} m`}
                    {r === 50 ? " — default" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                The rep&apos;s phone GPS accuracy is automatically added to this distance (up to 100 m) so
                honest reps standing at the shop are not wrongly blocked.
              </p>
            </label>
          </section>
        </>
      )}

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

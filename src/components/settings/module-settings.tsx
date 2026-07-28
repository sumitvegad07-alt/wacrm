"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { FileText, Coins, Truck, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// ── WhatsApp SVG icon (matches sidebar) ──────────────────────
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

// ── Module definition ─────────────────────────────────────────
interface ModuleDef {
  key: keyof ModuleSettings;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const MODULES: ModuleDef[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    description:
      "Enable WhatsApp integration — inbox, broadcasts, automations, templates, and knowledge base.",
    Icon: WhatsAppIcon,
  },
  {
    key: "quotation",
    label: "Quotation",
    description:
      "Enable quotation creation, management, and sharing with customers.",
    Icon: FileText,
  },
  {
    key: "expense",
    label: "Expense",
    description:
      "Enable expense tracking, approval workflows, and expense reporting.",
    Icon: Coins,
  },
  {
    key: "dispatch",
    label: "Dispatch",
    description:
      "Enable dispatch management for fulfilled orders.",
    Icon: Truck,
  },
  {
    key: "pending_dispatch",
    label: "Pending Dispatch",
    description:
      "Enable tracking of orders awaiting dispatch.",
    Icon: PackageCheck,
  },
];

// ── Toggle Switch ─────────────────────────────────────────────
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
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        enabled ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200",
          enabled ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────
export function ModuleSettingsPanel() {
  const { moduleSettings, isModuleEnabled, canEditSettings, refreshModuleSettings } =
    useAuth();

  const [draft, setDraft] = useState<ModuleSettings>({ ...moduleSettings });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Sync draft when moduleSettings change externally
  useEffect(() => {
    setDraft({ ...moduleSettings });
  }, [moduleSettings]);

  const handleToggle = (key: keyof ModuleSettings, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const isDirty = (Object.keys(draft) as (keyof ModuleSettings)[]).some(
    (k) => draft[k] !== moduleSettings[k]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/account/module-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      await refreshModuleSettings();
      setToast({ type: "success", message: "Module settings saved successfully." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, refreshModuleSettings]);

  const handleDiscard = () => {
    setDraft({ ...moduleSettings });
    setToast(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Module Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable or disable optional modules for your company. Disabled modules
          will be hidden from the navigation menu for all team members.
        </p>
      </div>

      {/* Read-only notice for non-admins */}
      {!canEditSettings && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Only admins and owners can change module settings. You are viewing the
          current configuration in read-only mode.
        </div>
      )}

      {/* Toast */}
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

      {/* Module Cards */}
      <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
        {MODULES.map(({ key, label, description, Icon }) => {
          const enabled = draft[key];
          return (
            <div
              key={key}
              className={cn(
                "flex items-start gap-4 rounded-xl border p-4 transition-colors",
                enabled
                  ? "border-border bg-card"
                  : "border-border/50 bg-muted/30"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                  enabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>

              {/* Text */}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    enabled ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </div>

              {/* Toggle */}
              <div className="shrink-0 pt-0.5">
                <Toggle
                  enabled={enabled}
                  onChange={(v) => handleToggle(key, v)}
                  disabled={!canEditSettings}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed Modules Note */}
      <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Fixed Modules (always enabled)
        </p>
        <p className="text-sm text-muted-foreground">
          My Activity, Dashboard, Customer, Product, Order, Lead, Deal, Report, User, Settings, Location Tracking
        </p>
      </div>

      {/* Action buttons — only for admins with unsaved changes */}
      {canEditSettings && isDirty && (
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={handleDiscard}
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

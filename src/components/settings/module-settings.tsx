"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import {
  FileText,
  Coins,
  Truck,
  PackageCheck,
  Map,
  Network,
  Route,
  Globe,
  SlidersHorizontal,
  ShieldAlert,
  Settings,
  Layers,
  PhoneCall,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Koops Screenshot Radio Button Toggle (No / Yes) ─────────────
function KoopsRadioToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-6 mt-2">
      <label
        onClick={() => !disabled && onChange(false)}
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
            !enabled
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/40 bg-background"
          )}
        >
          {!enabled && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span
          className={cn(
            !enabled ? "text-foreground font-semibold" : "text-muted-foreground"
          )}
        >
          No
        </span>
      </label>

      <label
        onClick={() => !disabled && onChange(true)}
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
            enabled
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/40 bg-background"
          )}
        >
          {enabled && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span
          className={cn(
            enabled ? "text-foreground font-semibold" : "text-muted-foreground"
          )}
        >
          Yes
        </span>
      </label>
    </div>
  );
}

// ── Extra Koops & Org Settings Types ──────────────────────────────
interface ExtraOrgConfig {
  estimate: boolean;
  invoice: boolean;
  work_profile: boolean;
  complaint: boolean;
  segment: boolean;
  call_recording: boolean;
  account_category: boolean;
  workflow: boolean;
  auto_assign_leads: boolean;
  check_duplicate_leads: boolean;
  require_dispatch_approval: boolean;
  require_receipt_above_500: boolean;
  strict_route_enforcement: boolean;
  default_currency: string;
  default_page_size: string;
  order_prefix: string;
}

const DEFAULT_EXTRA_CONFIG: ExtraOrgConfig = {
  estimate: false,
  invoice: false,
  work_profile: false,
  complaint: false,
  segment: false,
  call_recording: true,
  account_category: false,
  workflow: false,
  auto_assign_leads: true,
  check_duplicate_leads: true,
  require_dispatch_approval: false,
  require_receipt_above_500: true,
  strict_route_enforcement: false,
  default_currency: "INR (₹)",
  default_page_size: "10 rows per page",
  order_prefix: "ORD-",
};

// ── Main Component ────────────────────────────────────────────
export function ModuleSettingsPanel() {
  const { moduleSettings, canEditSettings, refreshModuleSettings } = useAuth();

  const [draft, setDraft] = useState<ModuleSettings>({ ...moduleSettings });
  const [extraConfig, setExtraConfig] = useState<ExtraOrgConfig>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("wacrm_org_extra_config");
      if (saved) {
        try {
          return { ...DEFAULT_EXTRA_CONFIG, ...JSON.parse(saved) };
        } catch {
          // ignore
        }
      }
    }
    return { ...DEFAULT_EXTRA_CONFIG };
  });

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Sync draft when moduleSettings change externally
  useEffect(() => {
    setDraft({ ...moduleSettings });
  }, [moduleSettings]);

  const handleModuleToggle = (key: keyof ModuleSettings, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleExtraToggle = (key: keyof ExtraOrgConfig, value: any) => {
    setExtraConfig((prev) => ({ ...prev, [key]: value }));
  };

  const isModuleDirty = (Object.keys(draft) as (keyof ModuleSettings)[]).some(
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
      if (typeof window !== "undefined") {
        localStorage.setItem("wacrm_org_extra_config", JSON.stringify(extraConfig));
      }
      setToast({
        type: "success",
        message: "Organization settings saved successfully.",
      });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setSaving(false);
    }
  }, [draft, extraConfig, refreshModuleSettings]);

  const handleDiscard = () => {
    setDraft({ ...moduleSettings });
    setExtraConfig({ ...DEFAULT_EXTRA_CONFIG });
    setToast(null);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Banner / Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Organization Settings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure active CRM modules, system toggles, and organization-wide
            rules for your team.
          </p>
        </div>

        {/* Action buttons at top right for immediate access */}
        {canEditSettings && (
          <div className="flex items-center gap-3 shrink-0">
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

      {/* Read-only notice for non-admins */}
      {!canEditSettings && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Only admins and owners can change organization settings. You are
          viewing the current configuration in read-only mode.
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

      {/* ── SECTION 1: KOOPS UI MODULES / SYSTEM CONFIG ── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h3 className="text-base font-semibold text-foreground">
            Modules / System config
          </h3>
        </div>

        {/* 4-column Koops grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-6">
          {/* 1. Sale Quotation */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Sale Quotation
            </p>
            <KoopsRadioToggle
              enabled={draft.quotation}
              onChange={(val) => handleModuleToggle("quotation", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 2. Estimate */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Estimate
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.estimate}
              onChange={(val) => handleExtraToggle("estimate", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 3. Invoice */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Invoice
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.invoice}
              onChange={(val) => handleExtraToggle("invoice", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 4. Can set routes for User */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Can set routes for User
            </p>
            <KoopsRadioToggle
              enabled={draft.route}
              onChange={(val) => handleModuleToggle("route", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 5. Can set work profile for User */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Can set work profile for User
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.work_profile}
              onChange={(val) => handleExtraToggle("work_profile", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 6. Enable Complaint */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Complaint
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.complaint}
              onChange={(val) => handleExtraToggle("complaint", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 7. Enable Segment */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Segment
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.segment}
              onChange={(val) => handleExtraToggle("segment", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 8. Enable phone call recording */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable phone call recording
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.call_recording}
              onChange={(val) => handleExtraToggle("call_recording", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 9. Enable account category */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable account category
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.account_category}
              onChange={(val) => handleExtraToggle("account_category", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 10. Enable Workflow */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Workflow
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.workflow}
              onChange={(val) => handleExtraToggle("workflow", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 11. Enable WhatsApp Integration */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable WhatsApp Integration
            </p>
            <KoopsRadioToggle
              enabled={draft.whatsapp}
              onChange={(val) => handleModuleToggle("whatsapp", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 12. Enable Expense Tracking */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Expense Tracking
            </p>
            <KoopsRadioToggle
              enabled={draft.expense}
              onChange={(val) => handleModuleToggle("expense", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 13. Enable Dispatch */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Dispatch
            </p>
            <KoopsRadioToggle
              enabled={draft.dispatch}
              onChange={(val) => handleModuleToggle("dispatch", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 14. Enable Pending Dispatch */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Pending Dispatch
            </p>
            <KoopsRadioToggle
              enabled={draft.pending_dispatch}
              onChange={(val) =>
                handleModuleToggle("pending_dispatch", val)
              }
              disabled={!canEditSettings}
            />
          </div>

          {/* 15. Enable Territory Master */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Territory Master
            </p>
            <KoopsRadioToggle
              enabled={draft.territory}
              onChange={(val) => handleModuleToggle("territory", val)}
              disabled={!canEditSettings}
            />
          </div>

          {/* 16. Enable Reporting Hierarchy */}
          <div>
            <p className="text-xs font-medium text-foreground">
              Enable Reporting Hierarchy
            </p>
            <KoopsRadioToggle
              enabled={draft.reporting_hierarchy}
              onChange={(val) =>
                handleModuleToggle("reporting_hierarchy", val)
              }
              disabled={!canEditSettings}
            />
          </div>
        </div>
      </div>

      {/* ── SECTION 2: FIXED MODULES (ALWAYS ENABLED) ── */}
      <div className="rounded-xl border border-border/60 bg-muted/20 px-6 py-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Fixed Modules (Always Enabled)
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            "My Activity",
            "Dashboard",
            "Customer",
            "Product",
            "Order",
            "Lead",
            "Deal",
            "Report",
            "User",
            "Settings",
            "Location Tracking",
          ].map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full bg-background border border-border px-3 py-1 text-xs font-medium text-foreground shadow-2xs"
            >
              <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* ── SECTION 3: SYSTEM PREFERENCES & FORMATTING ── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h3 className="text-base font-semibold text-foreground">
            System Preferences & Formatting
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <label className="block text-xs font-medium text-foreground mb-2">
              Default Currency
            </label>
            <select
              value={extraConfig.default_currency}
              onChange={(e) =>
                handleExtraToggle("default_currency", e.target.value)
              }
              disabled={!canEditSettings}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="INR (₹)">INR (₹)</option>
              <option value="USD ($)">USD ($)</option>
              <option value="EUR (€)">EUR (€)</option>
              <option value="GBP (£)">GBP (£)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-2">
              Default Table Page Size
            </label>
            <select
              value={extraConfig.default_page_size}
              onChange={(e) =>
                handleExtraToggle("default_page_size", e.target.value)
              }
              disabled={!canEditSettings}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="10 rows per page">10 rows per page (Default)</option>
              <option value="20 rows per page">20 rows per page</option>
              <option value="50 rows per page">50 rows per page</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-2">
              Order Number Prefix
            </label>
            <input
              type="text"
              value={extraConfig.order_prefix}
              onChange={(e) =>
                handleExtraToggle("order_prefix", e.target.value)
              }
              disabled={!canEditSettings}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* ── SECTION 4: LEAD & DEAL PIPELINE RULES ── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h3 className="text-base font-semibold text-foreground">
            Lead & Deal Pipeline Rules
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
          <div>
            <p className="text-xs font-medium text-foreground">
              Auto-assign incoming leads
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.auto_assign_leads}
              onChange={(val) =>
                handleExtraToggle("auto_assign_leads", val)
              }
              disabled={!canEditSettings}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-foreground">
              Check duplicate phone numbers
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.check_duplicate_leads}
              onChange={(val) =>
                handleExtraToggle("check_duplicate_leads", val)
              }
              disabled={!canEditSettings}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-foreground">
              Require manager approval for dispatch
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.require_dispatch_approval}
              onChange={(val) =>
                handleExtraToggle("require_dispatch_approval", val)
              }
              disabled={!canEditSettings}
            />
          </div>

          <div>
            <p className="text-xs font-medium text-foreground">
              Require receipt above ₹500
            </p>
            <KoopsRadioToggle
              enabled={extraConfig.require_receipt_above_500}
              onChange={(val) =>
                handleExtraToggle("require_receipt_above_500", val)
              }
              disabled={!canEditSettings}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

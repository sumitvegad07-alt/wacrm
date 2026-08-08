"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { CheckCircle2, Layers, GripVertical, Trash2, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_TRACKING,
  TRACKING_INTERVAL_OPTIONS,
  GRACE_MINUTE_OPTIONS,
  LEGACY_ENABLED_FOR_OLD_APKS,
  normalizeTrackingSettings,
  formatHHMM,
} from "@/lib/location/tracking-window";

interface HierarchyLevel {
  position: number;
  name: string;
  color?: string;
}

const LEVEL_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

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

// ── Koops Multi-Option Toggle ─────────────
function KoopsOptionToggle<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-6 mt-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <label
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            className={cn(
              "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border transition-colors shrink-0",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/40 bg-background"
              )}
            >
              {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span
              className={cn(
                isSelected ? "text-foreground font-semibold" : "text-muted-foreground"
              )}
            >
              {opt.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export function ModuleSettingsPanel() {
  const supabase = createClient();
  const { accountId, moduleSettings, canEditSettings, refreshModuleSettings } = useAuth();

  const [draft, setDraft] = useState<ModuleSettings>({ ...moduleSettings });
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Settings JSONB data
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [assignmentMode, setAssignmentMode] = useState<'area' | 'direct'>('area');
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [hsnEnabled, setHsnEnabled] = useState(false);
  const [levels, setLevels] = useState<HierarchyLevel[]>([]);
  const [originalSettings, setOriginalSettings] = useState<any>({});

  // Tracking interval + shift timings. Times are stored as 24h "HH:MM" strings so there is no
  // AM/PM ambiguity between the web form and the mobile app that reads them.
  const [trackingStart, setTrackingStart] = useState(DEFAULT_TRACKING.start_time);
  const [trackingEnd, setTrackingEnd] = useState(DEFAULT_TRACKING.end_time);
  const [trackingInterval, setTrackingInterval] = useState<number>(DEFAULT_TRACKING.interval_minutes);
  const [trackingGrace, setTrackingGrace] = useState<number>(DEFAULT_TRACKING.grace_minutes);

  // Sync draft when moduleSettings change externally
  useEffect(() => {
    setDraft({ ...moduleSettings });
  }, [moduleSettings]);

  // Load account settings JSONB
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    (async () => {
      setLoadingSettings(true);
      const { data } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
      if (active && data) {
        const s = data.settings || {};
        setOriginalSettings(s);
        setAssignmentMode(s.assignment_mode === 'direct' ? 'direct' : 'area');
        
        const os = s.order_settings || {};
        setHierarchyEnabled(!!os.hierarchy_enabled);
        setGstEnabled(!!s.gst_enabled);
        setHsnEnabled(!!s.hsn_enabled);

        const ts = normalizeTrackingSettings(s.tracking_settings);
            setTrackingStart(ts.start_time);
        setTrackingEnd(ts.end_time);
        setTrackingInterval(ts.interval_minutes);
        setTrackingGrace(ts.grace_minutes);
        setLevels(
          Array.isArray(os.levels) && os.levels.length > 0
            ? os.levels.map((l: HierarchyLevel, i: number) => ({ ...l, color: l.color || LEVEL_COLORS[i % LEVEL_COLORS.length] }))
            : [
                { position: 1, name: "Distributor", color: LEVEL_COLORS[0] },
                { position: 2, name: "Dealer", color: LEVEL_COLORS[1] },
              ]
        );
      }
      if (active) setLoadingSettings(false);
    })();
    return () => { active = false; };
  }, [accountId, supabase]);

  const handleModuleToggle = (key: keyof ModuleSettings, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const isModuleDirty = (Object.keys(draft) as (keyof ModuleSettings)[]).some(
    (k) => draft[k] !== moduleSettings[k]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setToastMsg(null);
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

      // Save extra settings (JSONB)
      const cleanLevels = levels
        .filter((l) => l.name.trim())
        .map((l, i) => ({ position: i + 1, name: l.name.trim(), color: l.color || LEVEL_COLORS[i % LEVEL_COLORS.length] }));
      
      const newSettings = {
        ...originalSettings,
        assignment_mode: assignmentMode,
        gst_enabled: gstEnabled,
        hsn_enabled: hsnEnabled,
        tracking_settings: {
          // Still written even though the UI no longer exposes it: APKs already in the field
          // read this flag as a tracking gate and would stop tracking entirely on false.
          enabled: LEGACY_ENABLED_FOR_OLD_APKS,
          start_time: trackingStart,
          end_time: trackingEnd,
          interval_minutes: trackingInterval,
          grace_minutes: trackingGrace,
        },
        order_settings: {
          ...originalSettings?.order_settings,
          hierarchy_enabled: hierarchyEnabled,
          levels: cleanLevels,
        },
        // Ensure company profile also receives GST and HSN flags
        company_profile: {
          ...(originalSettings?.company_profile || {}),
          gst_enabled: gstEnabled,
          hsn_enabled: hsnEnabled,
        },
      };

      const { error } = await supabase
        .from("accounts")
        .update({ settings: newSettings })
        .eq("id", accountId);

      if (error) throw new Error("Failed to save extra settings");
      setOriginalSettings(newSettings);
      
      // Update localStorage so sidebar immediately responds to Assignment Mode changes
      if (typeof window !== 'undefined') {
        localStorage.setItem('wacrm_assignment_mode', assignmentMode);
        window.dispatchEvent(new Event('wacrm_extra_settings_changed'));
      }

      setToastMsg({
        type: "success",
        message: "Organization settings saved successfully.",
      });
    } catch (err) {
      setToastMsg({
        type: "error",
        message: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setSaving(false);
    }
  }, [accountId, draft, assignmentMode, hierarchyEnabled, gstEnabled, hsnEnabled, levels, originalSettings, refreshModuleSettings, supabase, trackingStart, trackingEnd, trackingInterval, trackingGrace]);

  const handleDiscard = () => {
    setDraft({ ...moduleSettings });
    setAssignmentMode(originalSettings.assignment_mode === 'direct' ? 'direct' : 'area');
    setHierarchyEnabled(!!originalSettings.order_settings?.hierarchy_enabled);
    setGstEnabled(!!originalSettings.gst_enabled);
    setHsnEnabled(!!originalSettings.hsn_enabled);
    const ts = normalizeTrackingSettings(originalSettings.tracking_settings);
    setTrackingStart(ts.start_time);
    setTrackingEnd(ts.end_time);
    setTrackingInterval(ts.interval_minutes);
    setTrackingGrace(ts.grace_minutes);
    const osLevels = originalSettings.order_settings?.levels;
    setLevels(
      Array.isArray(osLevels) && osLevels.length > 0
        ? osLevels.map((l: HierarchyLevel, i: number) => ({ ...l, color: l.color || LEVEL_COLORS[i % LEVEL_COLORS.length] }))
        : [
            { position: 1, name: "Distributor", color: LEVEL_COLORS[0] },
            { position: 2, name: "Dealer", color: LEVEL_COLORS[1] },
          ]
    );
    setToastMsg(null);
  };

  function updateLevel(i: number, val: string) {
    const next = [...levels];
    next[i] = { ...next[i], name: val };
    setLevels(next);
  }
  function addLevel() {
    if (levels.length >= 5) { setToastMsg({ type: 'error', message: "Maximum 5 levels" }); return; }
    setLevels([...levels, { position: levels.length + 1, name: "", color: LEVEL_COLORS[levels.length % LEVEL_COLORS.length] }]);
  }
  function updateLevelColor(i: number, color: string) {
    const next = [...levels];
    next[i] = { ...next[i], color };
    setLevels(next);
  }
  function removeLevel(i: number) {
    setLevels(levels.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 border-b border-border pb-5">

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
      {toastMsg && (
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm font-medium",
            toastMsg.type === "success"
              ? "border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {toastMsg.message}
        </div>
      )}

      {/* ── SECTION 1: KOOPS UI MODULES / SYSTEM CONFIG ── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h3 className="text-base font-semibold text-foreground">
            Modules / System config
          </h3>
        </div>

        {/* 4-column Koops grid with only real WACRM modules */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-6">
          {/* 1. WhatsApp Integration */}
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

          {/* 2. Sale Quotation */}
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

          {/* 3. Expense Tracking */}
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

          {/* 4. Dispatch */}
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

          {/* 5. Pending Dispatch */}
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

          {/* 6. Territory Master */}
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

          {/* 7. Reporting Hierarchy */}
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

          {/* 8. Can set routes for User */}
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
        </div>
      </div>

      {/* ── SECTION 1B: EXTRA SETTINGS (HIERARCHY & ASSIGNMENT) ── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h3 className="text-base font-semibold text-foreground">
            Extra Settings
          </h3>
        </div>

        {loadingSettings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading extra settings...
          </div>
        ) : (
          <div className="space-y-10">
            {/* Customer & Lead Assignment to Employee */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">
                  Customer &amp; Lead Assignment to Employee
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose how you assign customers and leads to your employees.
                </p>
              </div>
              <KoopsOptionToggle
                options={[
                  { label: "Assign Area Wise", value: "area" },
                  { label: "Direct Assignment", value: "direct" },
                ]}
                value={assignmentMode}
                onChange={setAssignmentMode}
                disabled={!canEditSettings}
              />
            </div>

            {/* Sales Person Tracking — how often a location is recorded. Always on while
                punched in; deliberately NOT limited to shift hours (see the note below). */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">Sales Person Tracking</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The mobile app records a location at this interval the whole time a rep is
                  punched in — at any hour, night shifts included.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
                <span className="text-sm text-muted-foreground">Record a location every</span>
                <select
                  value={trackingInterval}
                  onChange={(e) => setTrackingInterval(Number(e.target.value))}
                  disabled={!canEditSettings}
                  aria-label="Tracking interval"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
                >
                  {TRACKING_INTERVAL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
                <p className="w-full text-xs text-muted-foreground">
                  Default is {DEFAULT_TRACKING.interval_minutes} minutes. Tracking starts at
                  punch-in and stops at punch-out.
                </p>
              </div>
            </div>

            {/* Shift Timings — attendance classification only. Kept visually separate from the
                interval above because conflating the two is exactly what caused a rep who
                punched in at 01:26 to be silently untracked against a 09:00–18:00 default. */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">Shift Timings</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your company&apos;s working hours. Used only to classify attendance —
                  Late Start, Early Leaving, Short Present, Present and Absent on the Attendance
                  page. These times never stop location tracking: a rep who is punched in is on
                  duty and is tracked whatever the hour.
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
                  <span className="text-sm text-muted-foreground">Shift runs</span>
                  <Input
                    type="time"
                    value={trackingStart}
                    onChange={(e) => setTrackingStart(e.target.value)}
                    disabled={!canEditSettings}
                    className="h-9 w-[120px] bg-background"
                    aria-label="Shift start time"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={trackingEnd}
                    onChange={(e) => setTrackingEnd(e.target.value)}
                    disabled={!canEditSettings}
                    className="h-9 w-[120px] bg-background"
                    aria-label="Shift end time"
                  />
                  <span className="text-sm text-muted-foreground">with</span>
                  <select
                    value={trackingGrace}
                    onChange={(e) => setTrackingGrace(Number(e.target.value))}
                    disabled={!canEditSettings}
                    aria-label="Attendance grace period"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
                  >
                    {GRACE_MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">grace</span>
                  <p className="w-full text-xs text-muted-foreground">
                    {formatHHMM(trackingStart)} – {formatHHMM(trackingEnd)}. A punch-in after{" "}
                    {formatHHMM(trackingStart)}
                    {trackingGrace > 0 && <> plus {trackingGrace} minutes</>} counts as Late Start.
                    An end time earlier than the start means a night shift that runs past midnight.
                  </p>
              </div>
            </div>

            {/* Enable GST */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">
                  Enable GST
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, GST and HSN code fields will be shown on invoices, quotations and product catalog.
                </p>
              </div>
              <KoopsRadioToggle
                enabled={gstEnabled}
                onChange={setGstEnabled}
                disabled={!canEditSettings}
              />
            </div>

            {/* Enable HSN Code */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">
                  Enable HSN Code
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, HSN/SAC codes will be required on products and shown on invoices and quotations.
                </p>
              </div>
              <KoopsRadioToggle
                enabled={hsnEnabled}
                onChange={setHsnEnabled}
                disabled={!canEditSettings}
              />
            </div>

            {/* Enable Customer Hierarchy */}
            <div>
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">
                  Enable customer hierarchy
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Off: every order is a simple direct order. On: orders are classified primary/secondary from the customer&apos;s level.
                </p>
              </div>
              <KoopsRadioToggle
                enabled={hierarchyEnabled}
                onChange={setHierarchyEnabled}
                disabled={!canEditSettings}
              />

              {hierarchyEnabled && (
                <div className="mt-4 max-w-xl space-y-3 p-4 border border-border rounded-lg bg-background">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Levels (Level 1 = top of chain)</p>
                  </div>
                  {levels.map((lvl, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/30 p-1 pr-2 border border-border rounded-md">
                      <div className="p-2 text-muted-foreground/50"><GripVertical className="size-4" /></div>
                      <span className="text-xs text-muted-foreground w-14">Level {i + 1}</span>
                      <Input
                        type="color"
                        value={lvl.color || LEVEL_COLORS[i % LEVEL_COLORS.length]}
                        onChange={(e) => updateLevelColor(i, e.target.value)}
                        disabled={!canEditSettings}
                        className="h-8 w-10 p-1 shrink-0 bg-transparent border-0"
                        title="Badge color"
                      />
                      <Input
                        value={lvl.name}
                        onChange={(e) => updateLevel(i, e.target.value)}
                        placeholder="e.g. Super Stockist"
                        disabled={!canEditSettings}
                        className="h-8 flex-1 bg-background"
                      />
                      {canEditSettings && (
                        <Button variant="ghost" size="sm" onClick={() => removeLevel(i)} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0">
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {canEditSettings && levels.length < 5 && (
                    <Button variant="outline" size="sm" onClick={addLevel} className="mt-2 text-xs h-8">
                      <Plus className="size-3 mr-1" /> Add level
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Orders from a Level 1 customer are tagged Primary; all others Secondary.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

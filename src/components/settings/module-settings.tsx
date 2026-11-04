"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { allowedModules } from "@/lib/plans/catalog";
import { Link } from "@/components/ui/link";
import { CheckCircle2, Layers, GripVertical, Trash2, Plus, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SettingsPanel,
  SettingsCard,
  SettingsRow,
} from "@/components/settings/settings-layout";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DEFAULT_TRACKING,
  TRACKING_INTERVAL_OPTIONS,
  GRACE_MINUTE_OPTIONS,
  LEGACY_ENABLED_FOR_OLD_APKS,
  normalizeTrackingSettings,
  formatHHMM,
} from "@/lib/location/tracking-window";
import { FENCE_RADII, normalizeGeoFencing } from "@/lib/location/geofence-config";
import { McpWorkforceAccessCard } from "@/components/settings/mcp-workforce-access";
import { DuplicatePreventionSettings } from "@/components/settings/duplicate-prevention-settings";
import { AutoCodesSettings } from "@/components/settings/auto-codes-settings";
import { SecondarySalesSettings } from "@/components/settings/secondary-sales-settings";
import { KoopsOptionToggle, KoopsRadioToggle } from "@/components/settings/koops-controls";
import {
  levelsProblem,
  readMappingMode,
  readSetupStatus,
  remapRpcFor,
  type MappingMode,
  type SecondarySalesSetup,
} from "@/lib/customers/mapping";
import {
  CODE_KINDS,
  CODE_KIND_META,
  DEFAULT_CODE_SETTINGS,
  readCodeSettings,
  type CodeKind,
  type CodeSettings,
} from "@/lib/codes/auto-codes";
import { errorMessage } from '@/lib/errors/message';
import {
  readCustomerUniqueKeys,
  readLeadUniqueKeys,
  type CustomerUniqueKey,
  type LeadUniqueKey,
} from "@/lib/dedupe/unique-keys";

/** The shape of accounts.settings this panel merges into. Only the nested blobs
 *  it re-spreads are named; everything else rides along untouched. */
type SettingsBlob = Record<string, unknown> & {
  order_settings?: Record<string, unknown>;
  extra_settings?: Record<string, unknown>;
  company_profile?: Record<string, unknown>;
  tracking_settings?: { working_days?: unknown };
};

interface HierarchyLevel {
  position: number;
  name: string;
  color?: string;
}

const LEVEL_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

// The plan-gated module toggles, in display order. Anything the account's plan
// does not include is hidden entirely (no greyed-out row) — founder request.
const MODULE_TOGGLES: { key: keyof ModuleSettings; label: string }[] = [
  { key: "whatsapp", label: "Enable WhatsApp Integration" },
  { key: "quotation", label: "Enable Sale Quotation" },
  { key: "expense", label: "Enable Expense Tracking" },
  { key: "payment", label: "Enable Payment Collection" },
  { key: "dispatch", label: "Enable Dispatch" },
  { key: "pending_dispatch", label: "Enable Pending Dispatch" },
  { key: "territory", label: "Enable Territory Master" },
  { key: "reporting_hierarchy", label: "Enable Reporting Hierarchy" },
  { key: "route", label: "Can set routes for User" },
];


// ── Feature row: master toggle on the left, its extra options on the right ──
// Used for settings that reveal more controls once enabled (Multi Unit,
// Customer Hierarchy, Geo-Fencing). When off, the right side stays empty so the
// row is just a compact toggle; when on, the options fill the otherwise-wasted
// right-hand space next to their own toggle.
function FeatureRow({
  label,
  description,
  enabled,
  onChange,
  disabled,
  children,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <KoopsRadioToggle enabled={enabled} onChange={onChange} disabled={disabled} />
      }
    >
      {enabled && children ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">{children}</div>
      ) : null}
    </SettingsRow>
  );
}

/**
 * A plain on/off setting. The toggle lands in the same right-hand column as
 * every other control on the panel, rather than under its own label where the
 * length of the label decided where it sat.
 */
function ToggleRow({
  label,
  description,
  enabled,
  onChange,
  disabled,
  children,
}: {
  label: string;
  description?: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <KoopsRadioToggle enabled={enabled} onChange={onChange} disabled={disabled} />
      }
    >
      {children}
    </SettingsRow>
  );
}

// ── Main Component ────────────────────────────────────────────
export function ModuleSettingsPanel() {
  const supabase = createClient();
  const {
    accountId,
    account,
    moduleSettings,
    canEditSettings,
    refreshModuleSettings,
    refreshProfile,
    hasSFA,
    hasWFA,
  } = useAuth();

  // Modules the account's plan includes. Legacy plans return the full set, so
  // those tenants keep every toggle. A module outside the plan is locked: the
  // control is disabled and the server clamps it off on save regardless.
  const planModules = allowedModules(account?.subscription_plan);
  const moduleLocked = (key: keyof ModuleSettings) =>
    !canEditSettings || !planModules.has(key as never);

  const [draft, setDraft] = useState<ModuleSettings>({ ...moduleSettings });
  const [moduleFilter, setModuleFilter] = useState("");
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
  // Multi Unit: base + conversion units per product; pricing/stock in base units.
  const [multiUnitEnabled, setMultiUnitEnabled] = useState(false);
  const [buyingStatusEnabled, setBuyingStatusEnabled] = useState(false);
  const [amountDiscountBasis, setAmountDiscountBasis] = useState<'entered' | 'base'>('entered');
  // Which field must be unique to block duplicates on save (per module).
  const [productUniqueKey, setProductUniqueKey] = useState<'name' | 'code'>('name');
  // Several fields may be ticked per module; any match blocks the save.
  const [customerUniqueKeys, setCustomerUniqueKeys] = useState<CustomerUniqueKey[]>(['name']);
  const [leadUniqueKeys, setLeadUniqueKeys] = useState<LeadUniqueKey[]>([]);
  // Geo-Fencing: one parent switch, two independent sub-switches.
  //   visit      — block visit check-in/out away from the customer's saved location
  //   attendance — block punch-in/out away from an Attendance Location
  // Both may be on at once; see @/lib/location/geofence-config for the shape and
  // for why visit defaults ON and attendance OFF when the keys are absent.
  const [geoFencingEnabled, setGeoFencingEnabled] = useState(false);
  const [geoVisitEnabled, setGeoVisitEnabled] = useState(true);
  const [geoAttendanceEnabled, setGeoAttendanceEnabled] = useState(false);
  // How many attendance locations exist, so we can warn that attendance fencing
  // is on but fencing nothing. null = not known (table absent / read failed).
  const [attendanceLocCount, setAttendanceLocCount] = useState<number | null>(null);
  const [geoEnforceCheckIn, setGeoEnforceCheckIn] = useState(true);
  const [geoEnforceCheckOut, setGeoEnforceCheckOut] = useState(false);
  const [geoRadius, setGeoRadius] = useState<number>(50);
  const [levels, setLevels] = useState<HierarchyLevel[]>([]);
  // Automatic codes. `lastUsed` comes from account_sequences so the "Next code"
  // line tells the truth on an account that has already minted codes, and
  // `blanks` comes from the backfill's own dry run so the number on the button
  // is counted exactly the way the backfill will count it.
  const [codeSettings, setCodeSettings] = useState<CodeSettings>(DEFAULT_CODE_SETTINGS);
  const [codeLastUsed, setCodeLastUsed] = useState<Partial<Record<CodeKind, number>>>({});
  const [codeBlanks, setCodeBlanks] = useState<Partial<Record<CodeKind, number>>>({});
  const [backfillKind, setBackfillKind] = useState<CodeKind | null>(null);
  // Customer mapping. `mappingWouldChange` comes from the re-map dry run, so
  // the button can say how many customers it will touch before it writes.
  const [mappingMode, setMappingMode] = useState<MappingMode>('off');
  const [mappingWouldChange, setMappingWouldChange] = useState<number | null>(null);
  // Whether secondary sales is really configured, not merely switched on: a
  // customer with no level classifies as `direct` and one with no supplier has
  // no channel, so a tenant can switch this on, see nothing change and conclude
  // the feature is broken.
  const [setupStatus, setSetupStatus] = useState<SecondarySalesSetup | null>(null);
  const [remapping, setRemapping] = useState(false);
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
        setMultiUnitEnabled(!!s.extra_settings?.multi_unit_enabled);
        setBuyingStatusEnabled(s.extra_settings?.buying_status_enabled === true);
        setProductUniqueKey(s.extra_settings?.product_unique_key === 'code' ? 'code' : 'name');
        setCustomerUniqueKeys(readCustomerUniqueKeys(s));
        setLeadUniqueKeys(readLeadUniqueKeys(s));
        setCodeSettings(readCodeSettings(s));
        setMappingMode(readMappingMode(s));
        setAmountDiscountBasis(os.amount_discount_basis === 'base' ? 'base' : 'entered');

        const gf = normalizeGeoFencing(s.geo_fencing);
        setGeoFencingEnabled(gf.enabled);
        setGeoVisitEnabled(gf.visit_enabled);
        setGeoAttendanceEnabled(gf.attendance_enabled);
        setGeoEnforceCheckIn(gf.enforce_check_in);
        setGeoEnforceCheckOut(gf.enforce_check_out);
        setGeoRadius(gf.radius_m);

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

  // How many attendance locations exist. Re-counted whenever the admin flips the
  // attendance switch, so the "nothing is fenced yet" warning shows up without a
  // reload. A read error (most likely: the migration has not been applied yet)
  // leaves the count unknown and simply hides the warning.
  useEffect(() => {
    if (!accountId || !geoAttendanceEnabled) {
      setAttendanceLocCount(null);
      return;
    }
    let active = true;
    (async () => {
      const { count, error } = await supabase
        .from("attendance_locations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("status", "Active");
      if (active) setAttendanceLocCount(error ? null : (count ?? 0));
    })();
    return () => { active = false; };
  }, [accountId, supabase, geoAttendanceEnabled]);

  /**
   * Counters and blank counts for the Automatic codes card.
   *
   * Re-read whenever a record type is switched on, so the "157 records have no
   * Customer Code" line and its button appear without a reload — the same
   * reason the attendance-location count above is keyed on its own switch.
   *
   * A read error (most likely: 20261103130000 has not been applied yet) leaves
   * both unknown, which hides the counts rather than showing a wrong zero.
   */
  const enabledCodeKinds = CODE_KINDS.filter((k) => codeSettings[k].enabled).join(',');
  useEffect(() => {
    if (!accountId) return;
    const kinds = enabledCodeKinds ? (enabledCodeKinds.split(',') as CodeKind[]) : [];
    if (kinds.length === 0) {
      setCodeLastUsed({});
      setCodeBlanks({});
      return;
    }
    let active = true;
    (async () => {
      const { data: seqRow } = await supabase
        .from('account_sequences')
        .select('customer_code_seq, employee_code_seq, product_code_seq')
        .eq('account_id', accountId)
        .maybeSingle();
      if (active && seqRow) {
        const row = seqRow as Record<string, number | null>;
        setCodeLastUsed({
          customer: row.customer_code_seq ?? 0,
          employee: row.employee_code_seq ?? 0,
          product: row.product_code_seq ?? 0,
        });
      }

      const counts: Partial<Record<CodeKind, number>> = {};
      for (const kind of kinds) {
        const { data, error } = await supabase.rpc('backfill_generated_codes', {
          p_account_id: accountId,
          p_kind: kind,
          p_dry_run: true,
        });
        if (!error && data) counts[kind] = Number((data as { pending?: number }).pending ?? 0);
      }
      if (active) setCodeBlanks(counts);
    })();
    return () => { active = false; };
  }, [accountId, supabase, enabledCodeKinds]);

  /** Give every record of one type that has no code a code. */
  const handleBackfillCodes = useCallback(async (kind: CodeKind) => {
    if (!accountId) return;
    setBackfillKind(kind);
    try {
      const { data, error } = await supabase.rpc('backfill_generated_codes', {
        p_account_id: accountId,
        p_kind: kind,
        p_dry_run: false,
      });
      if (error) throw error;
      const result = (data || {}) as { filled?: number; first?: string; last?: string };
      const filled = Number(result.filled ?? 0);
      setCodeBlanks((prev) => ({ ...prev, [kind]: 0 }));
      setToastMsg({
        type: 'success',
        message: filled === 0
          ? `No ${CODE_KIND_META[kind].label.toLowerCase()} records needed a code.`
          : `Gave a code to ${filled} ${CODE_KIND_META[kind].label.toLowerCase()} record${filled === 1 ? '' : 's'} (${result.first} to ${result.last}).`,
      });
    } catch (err) {
      setToastMsg({ type: 'error', message: errorMessage(err, 'Could not fill in the codes.') });
    } finally {
      setBackfillKind(null);
    }
  }, [accountId, supabase]);

  /**
   * How many customers the mapping rule would re-map, and whether secondary
   * sales is really configured.
   *
   * Both are tolerant of a read error — most likely the migration has not been
   * applied to this project yet — and hide themselves rather than showing a
   * wrong zero, which would read as "nothing to do".
   */
  useEffect(() => {
    const rpc = remapRpcFor(mappingMode);
    if (!accountId || !rpc) {
      setMappingWouldChange(null);
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc(rpc, {
        p_account_id: accountId,
        p_dry_run: true,
      });
      if (active) {
        setMappingWouldChange(
          error ? null : Number((data as { would_change?: number } | null)?.would_change ?? 0),
        );
      }
    })();
    return () => { active = false; };
  }, [accountId, supabase, mappingMode]);

  // Only fetched while secondary sales is switched on, so a tenant who does not
  // use it pays nothing for the counts.
  useEffect(() => {
    if (!accountId || !hierarchyEnabled) {
      setSetupStatus(null);
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc('secondary_sales_setup_status', {
        p_account_id: accountId,
      });
      if (active) setSetupStatus(error ? null : readSetupStatus(data));
    })();
    return () => { active = false; };
  }, [accountId, supabase, hierarchyEnabled, mappingMode]);

  /** Apply the current mapping rule to every customer in the account. */
  const handleRemapParents = useCallback(async () => {
    const rpc = remapRpcFor(mappingMode);
    if (!accountId || !rpc) return;
    const source = mappingMode === 'area' ? 'areas' : 'beats';
    setRemapping(true);
    try {
      const { data, error } = await supabase.rpc(rpc, {
        p_account_id: accountId,
        p_dry_run: false,
      });
      if (error) throw error;
      const changed = Number((data as { changed?: number } | null)?.changed ?? 0);
      setMappingWouldChange(0);
      const { data: status } = await supabase.rpc('secondary_sales_setup_status', {
        p_account_id: accountId,
      });
      if (status) setSetupStatus(readSetupStatus(status));
      setToastMsg({
        type: 'success',
        message: changed === 0
          ? `Every customer already matched their ${source === 'areas' ? 'area' : 'beat'}.`
          : `Re-mapped ${changed} customer${changed === 1 ? '' : 's'} from their ${source}.`,
      });
    } catch (err) {
      setToastMsg({ type: 'error', message: errorMessage(err, 'Could not re-map customers.') });
    } finally {
      setRemapping(false);
    }
  }, [accountId, supabase, mappingMode]);

  const handleModuleToggle = (key: keyof ModuleSettings, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const isModuleDirty = (Object.keys(draft) as (keyof ModuleSettings)[]).some(
    (k) => draft[k] !== moduleSettings[k]
  );

  const handleSave = useCallback(async () => {
    // Refused before anything is written, rather than saved and then quietly
    // useless: secondary sales with one level classifies every order as
    // primary, so the switch would be on and change nothing.
    const levelsIssue = levelsProblem(hierarchyEnabled, levels);
    if (levelsIssue) {
      setToastMsg({ type: 'error', message: levelsIssue });
      return;
    }
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
      
      // Merge onto the settings as they are RIGHT NOW, not onto the snapshot taken
      // when this panel mounted. accounts.settings is one JSONB column written by
      // several panels; spreading a stale snapshot silently reverts whatever was
      // saved elsewhere while this page sat open — including the geo-fencing
      // switches. Falls back to the snapshot if the re-read fails.
      const { data: freshRow } = await supabase
        .from("accounts")
        .select("settings")
        .eq("id", accountId)
        .maybeSingle();
      const baseSettings: SettingsBlob =
        (freshRow?.settings as SettingsBlob | null) ?? (originalSettings as SettingsBlob);

      const newSettings = {
        ...baseSettings,
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
          // Preserved verbatim from what was loaded. Weekly offs moved to holiday lists, but
          // this key is still the account-level fallback the attendance engine uses when an
          // employee somehow has no list at all — writing a default here would quietly
          // reintroduce a Mon–Fri assumption for that fallback.
          working_days:
            baseSettings?.tracking_settings?.working_days ?? DEFAULT_TRACKING.working_days,
        },
        order_settings: {
          ...baseSettings?.order_settings,
          hierarchy_enabled: hierarchyEnabled,
          levels: cleanLevels,
          amount_discount_basis: amountDiscountBasis,
        },
        // Automatic codes. Written as a whole object: every record type's rule
        // is held in state, so a partial merge could only ever resurrect a
        // stale rule an admin had just turned off.
        code_settings: codeSettings,
        extra_settings: {
          ...(baseSettings?.extra_settings || {}),
          multi_unit_enabled: multiUnitEnabled,
          buying_status_enabled: buyingStatusEnabled,
          customer_mapping_mode: mappingMode,
          product_unique_key: productUniqueKey,
          customer_unique_keys: customerUniqueKeys,
          lead_unique_keys: leadUniqueKeys,
          // The old single-choice key stays written so an older mobile build,
          // which reads only this, keeps behaving sensibly instead of falling
          // back to "name" when the admin picked code.
          customer_unique_key: customerUniqueKeys.includes('code') ? 'code' : 'name',
        },
        geo_fencing: {
          enabled: geoFencingEnabled,
          // Written explicitly from here on. Absent keys keep their legacy
          // meaning (visit on, attendance off) for tenants who never save.
          visit_enabled: geoVisitEnabled,
          attendance_enabled: geoAttendanceEnabled,
          enforce_check_in: geoEnforceCheckIn,
          enforce_check_out: geoEnforceCheckOut,
          radius_m: geoRadius,
        },
        // Ensure company profile also receives GST and HSN flags
        company_profile: {
          ...(baseSettings?.company_profile || {}),
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

      // Re-read the account row so `account.settings` in context matches what was
      // just saved. Without this the sidebar keeps the settings it read at login,
      // so switching attendance fencing on would not reveal the Attendance
      // Locations link until a full page reload.
      await refreshProfile();
      
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
        message: errorMessage(err, "An error occurred."),
      });
    } finally {
      setSaving(false);
    }
    // Every piece of state this handler reads has to be listed, or the closure
    // keeps the value from an earlier render and Save writes that instead —
    // reporting success while the admin's choice is thrown away. Buying Status,
    // Customer mapping and Automatic codes all shipped broken this way on
    // 3 Nov 2026. module-settings.deps.test.ts now fails the build on it.
  }, [accountId, draft, assignmentMode, hierarchyEnabled, gstEnabled, hsnEnabled, multiUnitEnabled, buyingStatusEnabled, mappingMode, codeSettings, productUniqueKey, customerUniqueKeys, leadUniqueKeys, amountDiscountBasis, geoFencingEnabled, geoVisitEnabled, geoAttendanceEnabled, geoEnforceCheckIn, geoEnforceCheckOut, geoRadius, levels, originalSettings, refreshModuleSettings, refreshProfile, supabase, trackingStart, trackingEnd, trackingInterval, trackingGrace]);

  const handleDiscard = () => {
    setDraft({ ...moduleSettings });
    setAssignmentMode(originalSettings.assignment_mode === 'direct' ? 'direct' : 'area');
    setHierarchyEnabled(!!originalSettings.order_settings?.hierarchy_enabled);
    setGstEnabled(!!originalSettings.gst_enabled);
    setHsnEnabled(!!originalSettings.hsn_enabled);
    setMultiUnitEnabled(!!originalSettings.extra_settings?.multi_unit_enabled);
    // Discard has to put these back too, or the panel keeps showing a choice it
    // did not save and the admin has no way to tell.
    setBuyingStatusEnabled(originalSettings.extra_settings?.buying_status_enabled === true);
    setMappingMode(readMappingMode(originalSettings));
    setCodeSettings(readCodeSettings(originalSettings));
    setProductUniqueKey(originalSettings.extra_settings?.product_unique_key === 'code' ? 'code' : 'name');
    setCustomerUniqueKeys(readCustomerUniqueKeys(originalSettings));
    setLeadUniqueKeys(readLeadUniqueKeys(originalSettings));
    setAmountDiscountBasis(originalSettings.order_settings?.amount_discount_basis === 'base' ? 'base' : 'entered');
    const gf = normalizeGeoFencing(originalSettings.geo_fencing);
    setGeoFencingEnabled(gf.enabled);
    setGeoVisitEnabled(gf.visit_enabled);
    setGeoAttendanceEnabled(gf.attendance_enabled);
    setGeoEnforceCheckIn(gf.enforce_check_in);
    setGeoEnforceCheckOut(gf.enforce_check_out);
    setGeoRadius(gf.radius_m);
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
    <SettingsPanel
      description="Which modules your organization uses, and how the shared behaviour of orders, customers and the field app is configured."
      actions={
        canEditSettings ? (
          <>
            <Button variant="outline" size="sm" onClick={handleDiscard} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        ) : undefined
      }
    >

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
      <SettingsCard
        title="Modules"
        description="Turn the features included in your plan on or off for your organization."
        action={
          <Input
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            placeholder="Find a setting…"
            aria-label="Find a module"
            className="h-7 w-full sm:w-56"
          />
        }
        bodyClassName="px-0 py-0"
      >

        {/* Two columns of aligned rows. It was a four-column grid with each
            toggle under its own label, so the labels wrapped to different
            heights and no two toggles lined up. Only modules the plan includes
            are shown — off-plan modules are hidden rather than greyed out. */}
        <div className="grid grid-cols-1 gap-x-8 px-4 lg:grid-cols-2">
          {MODULE_TOGGLES.filter((m) => planModules.has(m.key as never))
            .filter((m) => m.label.toLowerCase().includes(moduleFilter.trim().toLowerCase()))
            .map((m) => (
              <SettingsRow
                key={m.key}
                label={m.label}
                control={
                  <KoopsRadioToggle
                    enabled={!!draft[m.key]}
                    onChange={(val) => handleModuleToggle(m.key, val)}
                    disabled={moduleLocked(m.key)}
                  />
                }
              />
            ))}
        </div>
      </SettingsCard>

      {/* ── SECTION 1B: EXTRA SETTINGS (HIERARCHY & ASSIGNMENT) ── */}
      <SettingsCard
        title="Extra settings"
        description="Behaviour that applies across modules."
        bodyClassName="px-4 py-0"
      >

        {loadingSettings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading extra settings...
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
              <ToggleRow label="Enable GST" enabled={gstEnabled} onChange={setGstEnabled} disabled={!canEditSettings} />
              <ToggleRow label="Enable HSN Code" enabled={hsnEnabled} onChange={setHsnEnabled} disabled={!canEditSettings} />
            </div>

            {/* Settings that reveal more configuration when they are switched
                on. That configuration opens underneath the row rather than in a
                second column, so the control column never moves. */}
            <div>
              {hasSFA && (
                <FeatureRow
                  label="Enable Multi Unit"
                  description="Off: each product has one unit. On: add conversion units (e.g. 1 BOX = 12 PCS); reps order in any unit while price and stock stay in the base unit."
                  enabled={multiUnitEnabled}
                  onChange={setMultiUnitEnabled}
                  disabled={!canEditSettings}
                >
                  <p className="text-sm font-medium text-foreground">Amount discount is per…</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    When a rep gives a fixed “₹ off per unit” discount on a line entered in a bigger
                    unit, count it per entered unit (₹ off each BOX) or per base unit (₹ off each PCS).
                  </p>
                  <div className="mt-2">
                    <KoopsOptionToggle
                      options={[
                        { label: "Entered unit (per BOX)", value: "entered" },
                        { label: "Base unit (per PCS)", value: "base" },
                      ]}
                      value={amountDiscountBasis}
                      onChange={setAmountDiscountBasis}
                      disabled={!canEditSettings}
                    />
                  </div>
                </FeatureRow>
              )}

              <FeatureRow
                label="Show Buying Status on customers"
                description="Adds a second status — Buyer / Yet to Buy — alongside Active / Inactive. It answers “has this customer ever ordered?”, which Active / Inactive does not: a dealer who has never ordered is a current customer the rep is visiting BECAUSE he has not ordered yet. Worked out from order history; an order that was Cancelled or Rejected does not count."
                enabled={buyingStatusEnabled}
                onChange={setBuyingStatusEnabled}
                disabled={!canEditSettings}
              />

              {/* Secondary sales, in one card: the switch, the levels, the
                  mapping method and a way into the Mapping screen. It replaces
                  two separate settings in two separate screens — the founder:
                  "those 2 settings ... force users to perform two separate
                  tasks for one action". Everything it writes was already saved
                  atomically by handleSave below, so only the UI moved. */}
              <SecondarySalesSettings
                enabled={hierarchyEnabled}
                onEnabledChange={setHierarchyEnabled}
                levels={levels}
                onLevelName={updateLevel}
                onLevelColor={updateLevelColor}
                onAddLevel={addLevel}
                onRemoveLevel={removeLevel}
                mode={mappingMode}
                onModeChange={setMappingMode}
                wouldChange={mappingWouldChange}
                remapping={remapping}
                onRemap={handleRemapParents}
                setup={setupStatus}
                disabled={!canEditSettings}
              />

              <DuplicatePreventionSettings
                productUniqueKey={productUniqueKey}
                customerKeys={customerUniqueKeys}
                leadKeys={leadUniqueKeys}
                disabled={!canEditSettings}
                onChange={(next) => {
                  setProductUniqueKey(next.productUniqueKey);
                  setCustomerUniqueKeys(next.customerKeys);
                  setLeadUniqueKeys(next.leadKeys);
                }}
              />

              {/* Sits next to duplicate prevention on purpose: both answer
                  "what makes this record's code acceptable?". */}
              <AutoCodesSettings
                value={codeSettings}
                lastUsed={codeLastUsed}
                blanks={codeBlanks}
                busyKind={backfillKind}
                disabled={!canEditSettings}
                onChange={setCodeSettings}
                onBackfill={handleBackfillCodes}
              />

              <FeatureRow
                label="Enable Geo-Fencing"
                description="Off: a rep can start a visit or mark attendance from anywhere. On: choose what to fence — customer visits, attendance, or both."
                enabled={geoFencingEnabled}
                onChange={setGeoFencingEnabled}
                disabled={!canEditSettings}
              >
                <div className="space-y-5">
                  {/* ── Visits: the original fence, anchored on the customer ── */}
                  <ToggleRow
                    label="Geo-Fencing for Visit"
                    description="Reps must be near the customer’s saved location or they see “You are not in customer Range”. Tag your customers first."
                    enabled={geoVisitEnabled}
                    onChange={setGeoVisitEnabled}
                    disabled={!canEditSettings}
                  >
                    {geoVisitEnabled && (
                      <div className="border-l-2 border-border pl-4">
                        <ToggleRow label="Fence check-in" enabled={geoEnforceCheckIn} onChange={setGeoEnforceCheckIn} disabled={!canEditSettings} />
                        <ToggleRow label="Fence check-out" enabled={geoEnforceCheckOut} onChange={setGeoEnforceCheckOut} disabled={!canEditSettings} />
                        {!geoEnforceCheckIn && !geoEnforceCheckOut && (
                          <div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                            Visit fencing is on but neither check-in nor check-out is enforced — turn
                            on at least one, otherwise nothing is blocked.
                          </div>
                        )}
                        <SettingsRow
                          label="Allowed radius"
                          description="The phone’s GPS accuracy is added automatically (up to 100 m) so honest reps aren’t wrongly blocked."
                          control={
                            <select
                              value={geoRadius}
                              onChange={(e) => setGeoRadius(Number(e.target.value))}
                              disabled={!canEditSettings}
                              aria-label="Geo-fence radius"
                              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
                            >
                              {FENCE_RADII.map((r) => (
                                <option key={r} value={r}>
                                  {r >= 1000 ? `${r / 1000} km (${r} m)` : `${r} m`}
                                  {r === 50 ? " — default" : ""}
                                </option>
                              ))}
                            </select>
                          }
                        />
                      </div>
                    )}
                  </ToggleRow>

                  {/* ── Attendance: anchored on Attendance Locations, not the customer.
                      Independent of the visit switch — a tenant may fence both. Punch
                      only exists on the WFA line, so a CRM-only plan never sees this. ── */}
                  {hasWFA && (
                    <ToggleRow
                      label="Geo-Fencing for Attendance"
                      description="Reps must be at a work location you pin to punch in or out. Each location decides for itself whether it fences punch-in, punch-out or both."
                      enabled={geoAttendanceEnabled}
                      onChange={setGeoAttendanceEnabled}
                      disabled={!canEditSettings}
                    >
                      {geoAttendanceEnabled && (
                        <div className="space-y-3 border-l-2 border-border pl-4">
                          <p className="text-xs text-muted-foreground">
                            Anyone with no location assigned keeps punching from anywhere, so turning
                            this on can never lock your team out of its own attendance.
                          </p>
                          {attendanceLocCount === 0 && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                              No attendance locations yet, so nothing is fenced. Add one to start.
                            </div>
                          )}
                          <Link
                            href="/settings?tab=attendance_locations"
                            className={buttonVariants({ variant: "outline", size: "sm" }) + " h-8 text-xs"}
                          >
                            <MapPin className="size-3 mr-1" /> Manage Attendance Locations
                          </Link>
                        </div>
                      )}
                    </ToggleRow>
                  )}
                </div>
              </FeatureRow>
            </div>

            {/* ── Operational settings (kept as compact rows, with guidance) ── */}
            {/* Customer & Lead Assignment to Employee */}
            <SettingsRow
              label="Customer & Lead Assignment to Employee"
              description="Choose how you assign customers and leads to your employees."
              control={
                <KoopsOptionToggle
                  options={[
                    { label: "Assign Area Wise", value: "area" },
                    { label: "Direct Assignment", value: "direct" },
                  ]}
                  value={assignmentMode}
                  onChange={setAssignmentMode}
                  disabled={!canEditSettings}
                />
              }
            />

            {/* Sales Person Tracking — how often a location is recorded. Always on while
                punched in; deliberately NOT limited to shift hours (see the note below). */}
            <SettingsRow
              label="Sales Person Tracking"
              description="The mobile app records a location at this interval the whole time a rep is punched in — at any hour, night shifts included."
              control={
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <select
                  value={trackingInterval}
                  onChange={(e) => setTrackingInterval(Number(e.target.value))}
                  disabled={!canEditSettings}
                  aria-label="Tracking interval"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:opacity-50"
                >
                  {/* An account saved on a since-retired interval (5 minutes) keeps its value
                      visible rather than silently showing the wrong option — picking anything
                      else drops it for good. */}
                  {!TRACKING_INTERVAL_OPTIONS.includes(trackingInterval as never) && (
                    <option value={trackingInterval}>{trackingInterval} minutes (current)</option>
                  )}
                  {TRACKING_INTERVAL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
                </div>
              }
            >
              <p className="text-xs text-muted-foreground">
                Default is {DEFAULT_TRACKING.interval_minutes} minutes. Tracking starts at
                punch-in and stops at punch-out.
              </p>
            </SettingsRow>

            {/* Shift Timings — attendance classification only. Kept visually separate from the
                interval above because conflating the two is exactly what caused a rep who
                punched in at 01:26 to be silently untracked against a 09:00–18:00 default. */}
            <SettingsRow
              label="Shift Timings"
              description="Your company’s working hours. Used only to classify attendance — Late Start, Early Leaving, Short Present, Present and Absent on the Attendance page. These times never stop location tracking: a rep who is punched in is on duty and is tracked whatever the hour."
            >
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
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
            </SettingsRow>

            {/* Working days used to be configured here. They now live on HOLIDAY LISTS
                (Settings → Leave Settings → Holiday Lists), because field staff and office staff
                routinely need different weekly offs — one company-wide week could not express
                that. This card points at the new home rather than leaving a stale duplicate that
                would silently disagree with the lists. */}
            <SettingsRow
              label="Working Days & Holidays"
              description={
                <>
                  Weekly offs and holidays are set per <strong>holiday list</strong> and assigned to
                  employees, so field staff and office staff can have different weeks. Configure
                  them in <strong>Settings → Leave Settings → Holiday Lists</strong>.
                </>
              }
            />
          </div>
        )}
      </SettingsCard>

      {/* Owner-only. Separate card because this is the one setting here about
          PEOPLE rather than about the business. */}
      <McpWorkforceAccessCard />
    </SettingsPanel>
  );
}

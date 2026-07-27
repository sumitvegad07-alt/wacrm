"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Layers, GripVertical } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "./settings-panel-head";

interface HierarchyLevel {
  position: number;
  name: string;
  color?: string;
}

const LEVEL_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

// NOTE: Order status is no longer configurable. It's a fixed state machine
// (Pending → Approved → Part Dispatch → Dispatched, plus Rejected/Cancelled)
// enforced in the database (migrations 086 & 089), so the old editable
// order_statuses list was removed from this screen.
export function OrdersSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);

  // Hierarchy config (accounts.settings.order_settings)
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [levels, setLevels] = useState<HierarchyLevel[]>([]);
  const [savingHierarchy, setSavingHierarchy] = useState(false);

  // Customers with no level assigned. Only meaningful while hierarchy is on:
  // their orders classify as "direct" (meaning "not known yet") until someone
  // gives them a level.
  const [levelless, setLevelless] = useState<{ id: string; company: string | null; name: string | null }[]>([]);

  useEffect(() => {
    if (accountId) loadData();
  }, [accountId]);

  async function loadData() {
    setLoading(true);
    const [acctRes, levellessRes] = await Promise.all([
      supabase.from("accounts").select("settings").eq("id", accountId).single(),
      supabase
        .from("contacts")
        .select("id, company, name")
        .eq("account_id", accountId)
        .is("hierarchy_level", null)
        .order("company"),
    ]);
    setLevelless(levellessRes.data ?? []);
    const os = acctRes.data?.settings?.order_settings;
    setHierarchyEnabled(!!os?.hierarchy_enabled);
    setLevels(
      Array.isArray(os?.levels) && os.levels.length > 0
        ? os.levels.map((l: HierarchyLevel, i: number) => ({ ...l, color: l.color || LEVEL_COLORS[i % LEVEL_COLORS.length] }))
        : [
            { position: 1, name: "Distributor", color: LEVEL_COLORS[0] },
            { position: 2, name: "Dealer", color: LEVEL_COLORS[1] },
          ]
    );
    setLoading(false);
  }

  async function saveHierarchy(enabled: boolean, lvls: HierarchyLevel[]) {
    if (!accountId) return;
    setSavingHierarchy(true);
    const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const currentSettings = acct?.settings || {};
    const cleanLevels = lvls
      .filter((l) => l.name.trim())
      .map((l, i) => ({ position: i + 1, name: l.name.trim(), color: l.color || LEVEL_COLORS[i % LEVEL_COLORS.length] }));
    const { error } = await supabase
      .from("accounts")
      .update({ settings: { ...currentSettings, order_settings: { hierarchy_enabled: enabled, levels: cleanLevels } } })
      .eq("id", accountId);
    setSavingHierarchy(false);
    if (error) { toast.error("Failed to save hierarchy settings"); return; }
    toast.success("Hierarchy settings saved");
  }

  function updateLevel(i: number, val: string) {
    const next = [...levels];
    next[i] = { ...next[i], name: val };
    setLevels(next);
  }
  function addLevel() {
    if (levels.length >= 5) { toast.error("Maximum 5 levels"); return; }
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
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Order Settings"
        description="Configure your distribution hierarchy for primary/secondary order classification. Order statuses are fixed (Pending → Approved → Part Dispatch → Dispatched)."
      />

      {loading ? (
        <div className="p-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2 mt-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card">
            <div>
              <p className="font-medium text-sm">Enable distribution hierarchy</p>
              <p className="text-xs text-muted-foreground mt-1">
                Off: every order is a simple direct order. On: orders are classified primary/secondary from the customer&apos;s level.
              </p>
            </div>
            <Switch
              checked={hierarchyEnabled}
              onCheckedChange={(v) => setHierarchyEnabled(v)}
              disabled={!canEditSettings || savingHierarchy}
            />
          </div>

          {hierarchyEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Levels (Level 1 = top of chain → orders from Level 1 count as Primary)</p>
              </div>
              {levels.map((lvl, i) => (
                <div key={i} className="flex items-center gap-2 bg-card p-1 pr-2 border border-border rounded-md">
                  <div className="p-2 text-muted-foreground/50"><GripVertical className="size-4" /></div>
                  <span className="text-xs text-muted-foreground w-14">Level {i + 1}</span>
                  <Input
                    type="color"
                    value={lvl.color || LEVEL_COLORS[i % LEVEL_COLORS.length]}
                    onChange={(e) => updateLevelColor(i, e.target.value)}
                    disabled={!canEditSettings}
                    className="h-8 w-10 p-1 shrink-0"
                    title="Badge color"
                  />
                  <Input
                    value={lvl.name}
                    onChange={(e) => updateLevel(i, e.target.value)}
                    placeholder="e.g. Super Stockist"
                    disabled={!canEditSettings}
                    className="h-8 flex-1"
                  />
                  {canEditSettings && (
                    <Button variant="ghost" size="sm" onClick={() => removeLevel(i)} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              {canEditSettings && levels.length < 5 && (
                <Button variant="outline" size="sm" onClick={addLevel}>
                  <Plus className="size-4 mr-1" /> Add level
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Assign each customer their level on the customer page. Orders from a Level 1 customer are tagged Primary; all others Secondary.
              </p>

              {levelless.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
                    {levelless.length} customer{levelless.length === 1 ? "" : "s"} have no level yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Their orders are classified <span className="font-medium">Direct</span>, which here means
                    &ldquo;not known yet&rdquo; rather than a real position in your chain. Open each one and set
                    a level to have them counted as Primary or Secondary.
                  </p>
                  <ul className="mt-3 space-y-1">
                    {levelless.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/contacts/${c.id}`}
                          className="text-sm text-primary hover:underline underline-offset-2"
                        >
                          {c.company || c.name || "Unnamed customer"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {canEditSettings && (
            <div className="flex justify-end pt-2 border-t border-border/50">
              <Button onClick={() => saveHierarchy(hierarchyEnabled, levels)} disabled={savingHierarchy}>
                {savingHierarchy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

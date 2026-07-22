"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Tag, Layers, GripVertical } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPanelHead } from "./settings-panel-head";

interface OrderStatus {
  id: string;
  name: string;
  color: string;
}
interface HierarchyLevel {
  position: number;
  name: string;
  color?: string;
}

const LEVEL_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

const DEFAULT_STATUSES = [
  { name: "Placed", color: "#3b82f6" },
  { name: "Accepted", color: "#8b5cf6" },
  { name: "Dispatched", color: "#f59e0b" },
  { name: "Delivered", color: "#10b981" },
  { name: "Cancelled", color: "#ef4444" },
];

export function OrdersSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("statuses");

  // Statuses
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [isAdding, setIsAdding] = useState(false);

  // Hierarchy config (accounts.settings.order_settings)
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [levels, setLevels] = useState<HierarchyLevel[]>([]);
  const [savingHierarchy, setSavingHierarchy] = useState(false);

  useEffect(() => {
    if (accountId) loadData();
  }, [accountId]);

  async function loadData() {
    setLoading(true);
    const [stRes, acctRes] = await Promise.all([
      supabase.from("order_statuses").select("*").eq("account_id", accountId).order("position"),
      supabase.from("accounts").select("settings").eq("id", accountId).single(),
    ]);
    if (stRes.data) setStatuses(stRes.data);
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

  // ---- Statuses ----
  async function seedDefaults() {
    if (!accountId) return;
    setIsAdding(true);
    const rows = DEFAULT_STATUSES.map((s, i) => ({ account_id: accountId, name: s.name, color: s.color, position: i }));
    const { error } = await supabase.from("order_statuses").insert(rows);
    setIsAdding(false);
    if (error) { toast.error("Failed to create default statuses"); return; }
    toast.success("Default statuses created");
    loadData();
  }

  async function handleAddStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !newName.trim()) return;
    setIsAdding(true);
    const { error } = await supabase.from("order_statuses").insert({
      account_id: accountId,
      name: newName.trim(),
      color: newColor,
      position: statuses.length,
    });
    setIsAdding(false);
    if (error) { toast.error("Failed to add status"); return; }
    toast.success("Status added");
    setNewName("");
    setNewColor("#3b82f6");
    loadData();
  }

  async function handleDeleteStatus(id: string) {
    if (!confirm("Remove this status? Existing orders keep their current status; it just disappears from the dropdown.")) return;
    const { error } = await supabase.from("order_statuses").delete().eq("id", id);
    if (error) { toast.error("Failed to delete status"); return; }
    toast.success("Deleted");
    loadData();
  }

  // ---- Hierarchy ----
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
        description="Configure order statuses and your distribution hierarchy for primary/secondary classification."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
        </TabsList>

        <TabsContent value="statuses">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2 mt-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : (
            <>
              {canEditSettings && (
                <form onSubmit={handleAddStatus} className="mt-6 flex items-end gap-4 p-4 border border-border rounded-lg bg-muted/30">
                  <div className="grid gap-2 flex-1">
                    <Label>New status name</Label>
                    <Input required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Out for delivery" />
                  </div>
                  <div className="grid gap-2 w-24">
                    <Label>Color</Label>
                    <Input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="p-1 h-9" />
                  </div>
                  <Button type="submit" disabled={isAdding}>
                    {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
                  </Button>
                </form>
              )}

              {statuses.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed mt-4">
                  No order statuses yet.
                  {canEditSettings && (
                    <div className="mt-3">
                      <Button variant="outline" size="sm" onClick={seedDefaults} disabled={isAdding}>
                        Create default statuses (Placed → Delivered)
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {statuses.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
                      <div className="flex items-center gap-3">
                        <div className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="font-medium text-sm flex items-center gap-2">
                          <Tag className="h-3 w-3 text-muted-foreground" /> {item.name}
                        </span>
                      </div>
                      {canEditSettings && (
                        <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteStatus(item.id)} className="text-red-400 hover:text-red-500 hover:bg-red-500/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="hierarchy">
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
        </TabsContent>
      </Tabs>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Layers, GripVertical, MapPin, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SettingsPanelHead } from "./settings-panel-head";
import { getAccountTerritorySettings, updateTerritorySettings } from "@/lib/territories/api";
import { DEFAULT_TERRITORY_LEVELS } from "@/lib/territories/settings";
import type { AssignmentMode, TerritoryLevel } from "@/lib/territories/types";

interface AffectedLevel { position: number; name: string; count: number }

export function TerritorySettings() {
  const { accountId, canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [levels, setLevels] = useState<TerritoryLevel[]>(DEFAULT_TERRITORY_LEVELS.map((l) => ({ ...l })));
  const [mode, setMode] = useState<AssignmentMode>("direct");
  const [confirm, setConfirm] = useState<{ affected: AffectedLevel[] } | null>(null);

  useEffect(() => {
    if (accountId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function load() {
    if (!accountId) return;
    setLoading(true);
    try {
      const s = await getAccountTerritorySettings(accountId);
      setLevels(s.levels.map((l) => ({ ...l })));
      setMode(s.assignment_mode);
    } catch {
      toast.error("Failed to load territory settings");
    } finally {
      setLoading(false);
    }
  }

  function setLevelName(i: number, name: string) {
    setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, name } : l)));
  }
  function setLevelEnabled(i: number, enabled: boolean) {
    setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, enabled } : l)));
  }

  async function persist(withConfirm: boolean) {
    if (!accountId) return;
    const cleaned = levels.map((l, i) => ({ position: i + 1, name: l.name.trim() || `Level ${i + 1}`, enabled: l.enabled }));
    if (!cleaned.some((l) => l.enabled)) {
      toast.error("At least one level must stay enabled");
      return;
    }
    setSaving(true);
    try {
      const res = (await updateTerritorySettings(accountId, cleaned, mode, withConfirm)) as {
        ok: boolean;
        requires_confirmation?: boolean;
        affected?: AffectedLevel[];
        archived?: number;
      };
      if (!res.ok && res.requires_confirmation) {
        setConfirm({ affected: res.affected ?? [] });
        return;
      }
      setConfirm(null);
      const archived = res.archived ?? 0;
      toast.success(archived > 0 ? `Saved. Archived ${archived} territories at disabled levels.` : "Territory settings saved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Territory Settings"
        description="Configure your geographic hierarchy — enable/disable and rename up to 5 levels — and how field employees are assigned to areas. This drives customer geography, Employee Area Assignment, and (later) Route Management."
      />

      {loading ? (
        <div className="p-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2 mt-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* Levels */}
          <div className="space-y-3 p-4 border border-border rounded-lg bg-card">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Hierarchy levels (Level 1 = broadest, e.g. Country)</p>
            </div>
            {levels.map((lvl, i) => (
              <div key={i} className="flex items-center gap-2 bg-background p-1 pr-2 border border-border rounded-md">
                <div className="p-2 text-muted-foreground/50"><GripVertical className="size-4" /></div>
                <span className="text-xs text-muted-foreground w-14">Level {i + 1}</span>
                <Input
                  value={lvl.name}
                  onChange={(e) => setLevelName(i, e.target.value)}
                  placeholder={`e.g. ${DEFAULT_TERRITORY_LEVELS[i]?.name ?? "Level"}`}
                  disabled={!canEditSettings || !lvl.enabled}
                  className="h-8 flex-1"
                />
                <Switch
                  checked={lvl.enabled}
                  onCheckedChange={(v) => setLevelEnabled(i, v)}
                  disabled={!canEditSettings}
                  aria-label={`Enable level ${i + 1}`}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Disabling a level that already has territories archives them (they can be restored) — you&apos;ll be asked to confirm.
            </p>
          </div>

          {/* Assignment mode */}
          <div className="space-y-4">
            <div className="p-4 border border-border rounded-lg bg-card space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Employee assignment mode</p>
              </div>
              <label className="flex items-start gap-3 p-3 rounded-md border border-border cursor-pointer">
                <input
                  type="radio"
                  name="assignment-mode"
                  checked={mode === "direct"}
                  onChange={() => setMode("direct")}
                  disabled={!canEditSettings}
                  className="mt-1"
                />
                <span>
                  <span className="text-sm font-medium block">Direct (manual)</span>
                  <span className="text-xs text-muted-foreground">You pick each customer&apos;s owner yourself. Areas can be shared by multiple employees.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-md border border-border cursor-pointer">
                <input
                  type="radio"
                  name="assignment-mode"
                  checked={mode === "area_wise"}
                  onChange={() => setMode("area_wise")}
                  disabled={!canEditSettings}
                  className="mt-1"
                />
                <span>
                  <span className="text-sm font-medium block">Area-wise (auto ownership)</span>
                  <span className="text-xs text-muted-foreground">Each area belongs to exactly one employee; customers in that area are auto-owned by them. Assigning a second employee to a taken area is blocked.</span>
                </span>
              </label>
            </div>

            {canEditSettings && (
              <div className="flex justify-end">
                <Button onClick={() => persist(false)} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Save changes
                </Button>
              </div>
            )}
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">Only admins and owners can change territory settings.</p>
            )}
          </div>
        </div>
      )}

      {/* Confirm archive-on-disable (Q2) */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-5 w-5" /> Disable levels with existing data?
            </DialogTitle>
            <DialogDescription>
              You&apos;re disabling levels that currently have territories. Confirming will archive them
              (they are hidden but recoverable — not deleted).
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 py-2">
            {confirm?.affected.map((a) => (
              <li key={a.position} className="text-sm">
                <span className="font-medium">{a.name}</span> (Level {a.position}) —{" "}
                <span className="text-amber-600 dark:text-amber-500">{a.count} territor{a.count === 1 ? "y" : "ies"}</span> will be archived
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => persist(true)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Archive &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

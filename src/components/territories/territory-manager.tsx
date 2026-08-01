"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Map as MapIcon,
  Search,
  Plus,
  Download,
  Upload,
  Loader2,
  Database,
  Layers,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
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
import { TerritoryTree } from "@/components/territories/territory-tree";
import { TerritoryImportDialog } from "@/components/territories/territory-import-dialog";
import { TerritorySettings as TerritoryConfigPanel } from "@/components/settings/territory-settings";
import { TerritoryFormDialog, type TerritoryFormValues } from "@/components/territories/territory-form-dialog";
import {
  getTerritoryRows,
  buildTree,
  getAccountTerritorySettings,
  createTerritory,
  updateTerritory,
  archiveTerritory,
  restoreTerritory,
  deleteTerritory,
  migrateContactGeo,
  countMigratableContacts,
  seedDefaultTerritories,
  bulkExportTerritories,
} from "@/lib/territories/api";
import { DEFAULT_TERRITORY_SETTINGS } from "@/lib/territories/settings";
import type { Territory, TerritoryNode, TerritorySettings } from "@/lib/territories/types";

type EditState =
  | { mode: "create"; presetLevel?: number; presetParentPath?: string[] }
  | { mode: "edit"; node: TerritoryNode };

type BlockedArchive = { node: TerritoryNode; contacts: number; assignments: number };
type BlockedDelete = { node: TerritoryNode; children: number; contacts: number; assignments: number };

function nextEnabledLevel(settings: TerritorySettings, after: number): number | null {
  const p = settings.levels.filter((l) => l.enabled && l.position > after).map((l) => l.position).sort((a, b) => a - b);
  return p[0] ?? null;
}

export function TerritoryManager() {
  const { accountId, canEditSettings, isModuleEnabled, profileLoading } = useAuth();
  const canEdit = canEditSettings;

  const [tab, setTab] = useState<"tree" | "config">("tree");
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TerritorySettings>(DEFAULT_TERRITORY_SETTINGS);
  const [allRows, setAllRows] = useState<Territory[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [edit, setEdit] = useState<EditState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [blockedArchive, setBlockedArchive] = useState<BlockedArchive | null>(null);
  const [blockedDelete, setBlockedDelete] = useState<BlockedDelete | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TerritoryNode | null>(null);
  const [migratable, setMigratable] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      // Fetch everything (incl. archived) once; the "Show archived" toggle then
      // filters in-memory, so toggling is instant and we can show a count.
      const [s, rows, mig] = await Promise.all([
        getAccountTerritorySettings(accountId),
        getTerritoryRows(accountId, { includeArchived: true }),
        countMigratableContacts(accountId).catch(() => 0),
      ]);
      setSettings(s);
      setAllRows(rows);
      setMigratable(mig);
    } catch {
      toast.error("Failed to load territories");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (accountId) load();
  }, [accountId, load]);

  const archivedCount = useMemo(() => allRows.filter((r) => r.deleted_at).length, [allRows]);
  const roots = useMemo(
    () => buildTree(showArchived ? allRows : allRows.filter((r) => !r.deleted_at)),
    [allRows, showArchived]
  );
  const totalCount = useMemo(() => {
    let n = 0;
    const walk = (list: TerritoryNode[]) => list.forEach((x) => { n++; walk(x.children); });
    walk(roots);
    return n;
  }, [roots]);

  // ── actions ─────────────────────────────────────────────
  async function onExport() {
    if (!accountId) return;
    try {
      const csv = await bulkExportTerritories(accountId);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `territories-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  }

  async function onSeed() {
    if (!accountId) return;
    setBusy(true);
    try {
      const res = (await seedDefaultTerritories(accountId)) as { skipped?: boolean; countries?: number; states?: number; districts?: number };
      if (res.skipped) toast.info("Seed skipped — this account already has default data.");
      else toast.success(`Loaded India with ${(res.states ?? 0)} states/UTs and ${(res.districts ?? 0)} districts.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Seeding failed");
    } finally {
      setBusy(false);
    }
  }

  async function onMigrate() {
    if (!accountId) return;
    setBusy(true);
    try {
      const res = (await migrateContactGeo(accountId)) as { matched: number; unmatched: number };
      toast.success(`Migration complete — ${res.matched} matched, ${res.unmatched} flagged for review.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(values: TerritoryFormValues) {
    if (!edit || !accountId) return;
    setBusy(true);
    try {
      const { level, parentId, name, code, notes, status } = values;
      let res;
      if (edit.mode === "edit") {
        res = await updateTerritory(edit.node.id, { name, code, notes, status });
      } else {
        res = await createTerritory({ accountId, parentId, level, name, code, notes, status });
      }
      if (!res.ok) {
        toast.error(res.reason === "duplicate" ? "A territory with this name already exists under the same parent." : res.message ?? "Save failed");
        return;
      }
      toast.success(edit.mode === "edit" ? "Territory updated" : "Territory created");
      setEdit(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function startAdd(parent: TerritoryNode) {
    const childLevel = nextEnabledLevel(settings, parent.level);
    if (!childLevel) {
      toast.error("No deeper level is enabled. Enable one in Territory Settings first.");
      return;
    }
    // Prefill the parent chain (root → this node) so the new child slots in under it.
    const byId = new Map(allRows.map((r) => [r.id, r]));
    const chain: string[] = [];
    let cur: Territory | undefined = parent;
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    setEdit({ mode: "create", presetLevel: childLevel, presetParentPath: chain });
  }

  async function doArchive(node: TerritoryNode, force: boolean) {
    setBusy(true);
    try {
      const res = (await archiveTerritory(node.id, force)) as { ok: boolean; blocked?: boolean; attached_contacts?: number; attached_assignments?: number; archived?: number };
      if (!res.ok && res.blocked) {
        setBlockedArchive({ node, contacts: res.attached_contacts ?? 0, assignments: res.attached_assignments ?? 0 });
        return;
      }
      setBlockedArchive(null);
      toast.success(`Archived ${res.archived ?? 1} territor${(res.archived ?? 1) === 1 ? "y" : "ies"}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(node: TerritoryNode) {
    setBusy(true);
    try {
      const res = (await restoreTerritory(node.id)) as { ok: boolean; reason?: string; restored?: number };
      if (!res.ok) {
        toast.error(res.reason === "parent_archived" ? "Restore the parent territory first." : "Restore failed");
        return;
      }
      toast.success(`Restored ${res.restored ?? 1} territor${(res.restored ?? 1) === 1 ? "y" : "ies"}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(node: TerritoryNode) {
    setBusy(true);
    try {
      const res = (await deleteTerritory(node.id)) as { ok: boolean; blocked?: boolean; children?: number; attached_contacts?: number; attached_assignments?: number };
      if (!res.ok && res.blocked) {
        setConfirmDelete(null);
        setBlockedDelete({ node, children: res.children ?? 0, contacts: res.attached_contacts ?? 0, assignments: res.attached_assignments ?? 0 });
        return;
      }
      toast.success("Territory deleted.");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  // ── render ──────────────────────────────────────────────
  if (!profileLoading && !isModuleEnabled("territory")) {
    return (
      <div className="w-full p-8">
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
          <MapIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Territory Master is disabled</h2>
          <p className="mt-1 text-sm text-muted-foreground">An admin can enable it under Settings → Module Settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 p-2 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Territory Master</h1>
            <p className="text-sm text-muted-foreground">
              {totalCount} territor{totalCount === 1 ? "y" : "ies"} · single source of truth for customer geography
            </p>
          </div>
        </div>
        {tab === "tree" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExport} disabled={totalCount === 0}>
              <Download className="size-4 mr-1" /> Export
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload className="size-4 mr-1" /> Import
                </Button>
                <Button size="sm" onClick={() => setEdit({ mode: "create" })}>
                  <Plus className="size-4 mr-1" /> Add Territory
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs: manage the tree vs configure levels/assignment */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: "tree", label: "Manage territories" },
          { id: "config", label: "Hierarchy & assignment" },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "config" && <TerritoryConfigPanel />}
      {tab === "tree" && (
      <>{/* ── tree tab ── */}

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search territories…" className="pl-8 h-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground" title="Archived territories are hidden but not deleted (e.g. from disabling a level, or the Archive action). Toggle to view/restore them.">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} disabled={archivedCount === 0} />
          Show archived ({archivedCount})
        </label>
      </div>

      {/* body */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : totalCount === 0 && !showArchived ? (
        <EmptyState canEdit={canEdit} busy={busy} onSeed={onSeed} onAdd={() => setEdit({ mode: "create" })} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-2 md:p-3">
          <TerritoryTree
            roots={roots}
            settings={settings}
            canEdit={canEdit}
            search={search.trim().toLowerCase()}
            onAdd={startAdd}
            onEdit={(n) => setEdit({ mode: "edit", node: n })}
            onArchive={(n) => doArchive(n, false)}
            onRestore={doRestore}
            onDelete={(n) => setConfirmDelete(n)}
          />
        </div>
      )}

      {/* Old-data cleanup — only shown when some customers still have typed-in
          locations that aren't linked to a territory yet. */}
      {canEdit && migratable > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Layers className="size-5 text-amber-600 dark:text-amber-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Link old customer locations to this list</p>
              <p className="text-xs text-muted-foreground max-w-xl">
                {migratable} customer{migratable === 1 ? "" : "s"} still {migratable === 1 ? "has" : "have"} a country/state/city
                typed in the old way, before this Territory list existed. This button matches each one to the right territory here
                (by name). Any it can&apos;t match confidently are marked &ldquo;needs review&rdquo; for you to set by hand — nothing is guessed.
                It&apos;s safe to click more than once.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onMigrate} disabled={busy}>
            {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <RefreshCw className="size-4 mr-1" />}
            Link old locations
          </Button>
        </div>
      )}
      </>
      )}

      {/* create/edit dialog */}
      {edit && (
        <TerritoryFormDialog
          open
          onClose={() => setEdit(null)}
          settings={settings}
          rows={allRows.filter((r) => !r.deleted_at)}
          mode={edit.mode}
          editNode={edit.mode === "edit" ? edit.node : undefined}
          presetLevel={edit.mode === "create" ? edit.presetLevel : undefined}
          presetParentPath={edit.mode === "create" ? edit.presetParentPath : undefined}
          busy={busy}
          onSubmit={saveEdit}
        />
      )}

      {/* import */}
      {accountId && (
        <TerritoryImportDialog accountId={accountId} open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      )}

      {/* confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{confirmDelete?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently removes the territory. Only childless, unattached territories can be hard-deleted —
              otherwise use Archive. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && doDelete(confirmDelete)} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-1 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* blocked archive (attached) */}
      <Dialog open={!!blockedArchive} onOpenChange={(o) => !o && setBlockedArchive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <AlertTriangle className="size-5" /> Territory has attached records
            </DialogTitle>
            <DialogDescription>
              &ldquo;{blockedArchive?.node.name}&rdquo; (and its subtree) has{" "}
              <strong>{blockedArchive?.contacts ?? 0}</strong> customer(s) and{" "}
              <strong>{blockedArchive?.assignments ?? 0}</strong> employee assignment(s) attached. Archiving anyway
              keeps those links but hides the territory. Prefer reassigning them first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockedArchive(null)}>Cancel</Button>
            <Button onClick={() => blockedArchive && doArchive(blockedArchive.node, true)} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-1 animate-spin" />} Archive anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* blocked delete */}
      <Dialog open={!!blockedDelete} onOpenChange={(o) => !o && setBlockedDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" /> Can&apos;t delete this territory
            </DialogTitle>
            <DialogDescription>
              &ldquo;{blockedDelete?.node.name}&rdquo; has{" "}
              <strong>{blockedDelete?.children ?? 0}</strong> child territor(ies),{" "}
              <strong>{blockedDelete?.contacts ?? 0}</strong> customer(s) and{" "}
              <strong>{blockedDelete?.assignments ?? 0}</strong> assignment(s). Reassign or archive those first,
              or use Archive instead of Delete.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setBlockedDelete(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── empty state ───────────────────────────────────────────
function EmptyState({ canEdit, busy, onSeed, onAdd }: { canEdit: boolean; busy: boolean; onSeed: () => void; onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <MapIcon className="size-8 text-primary" />
      </div>
      <h2 className="mb-2 text-xl font-semibold">No territories yet</h2>
      <p className="mx-auto mb-6 max-w-sm text-sm text-muted-foreground">
        Load India&apos;s geography (28 states + 8 UTs and ~762 districts). India is the only
        country preloaded — add others yourself if you ever need them.
      </p>
      {canEdit ? (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onSeed} disabled={busy}>
            {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Database className="size-4 mr-1" />}
            Load default India data
          </Button>
          <Button variant="outline" onClick={onAdd} disabled={busy}>
            <Plus className="size-4 mr-1" /> Start from scratch
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ask an admin to set up the territory hierarchy.</p>
      )}
    </div>
  );
}


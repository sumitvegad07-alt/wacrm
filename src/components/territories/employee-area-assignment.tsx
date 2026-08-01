"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Loader2, MapPin, Search, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  getTerritoryTree,
  getAccountTerritorySettings,
  getEmployeeAssignedAreas,
  assignEmployeeAreas,
} from "@/lib/territories/api";
import { enabledLevels, levelName } from "@/lib/territories/settings";
import type { TerritoryNode, TerritorySettings } from "@/lib/territories/types";

interface Props {
  employeeId: string; // profiles.id
  accountId: string;
  canEdit: boolean; // admin+
}

/** All ids in a subtree, including the node itself. */
function subtreeIds(node: TerritoryNode): string[] {
  const out: string[] = [node.id];
  node.children.forEach((c) => out.push(...subtreeIds(c)));
  return out;
}

function matches(n: TerritoryNode, q: string): boolean {
  return n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q);
}

/** Filter to nodes matching or with a matching descendant; collect ids to force-expand. */
function filterTree(nodes: TerritoryNode[], q: string): { nodes: TerritoryNode[]; expand: Set<string> } {
  if (!q) return { nodes, expand: new Set() };
  const expand = new Set<string>();
  const walk = (list: TerritoryNode[]): TerritoryNode[] =>
    list
      .map((n) => {
        const kids = walk(n.children);
        if (matches(n, q) || kids.length > 0) {
          if (kids.length > 0) expand.add(n.id);
          return { ...n, children: kids };
        }
        return null;
      })
      .filter((n): n is TerritoryNode => n !== null);
  return { nodes: walk(nodes), expand };
}

export function EmployeeAreaAssignment({ employeeId, accountId, canEdit }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<TerritorySettings | null>(null);
  const [roots, setRoots] = useState<TerritoryNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!accountId || !employeeId) return;
    setLoading(true);
    try {
      const [s, tree, assigned] = await Promise.all([
        getAccountTerritorySettings(accountId),
        getTerritoryTree(accountId),
        getEmployeeAssignedAreas(employeeId),
      ]);
      setSettings(s);
      setRoots(tree);
      setSelected(new Set(assigned));
      const assignedSet = new Set(assigned);
      const exp = new Set<string>();
      const walk = (n: TerritoryNode, anc: string[]) => {
        if (assignedSet.has(n.id)) anc.forEach((a) => exp.add(a));
        n.children.forEach((c) => walk(c, [...anc, n.id]));
      };
      tree.forEach((r) => walk(r, []));
      setExpanded(exp);
    } catch {
      toast.error("Failed to load area assignments");
    } finally {
      setLoading(false);
    }
  }, [accountId, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalTerritories = useMemo(() => {
    let n = 0;
    const walk = (l: TerritoryNode[]) => l.forEach((x) => { n++; walk(x.children); });
    walk(roots);
    return n;
  }, [roots]);

  const view = useMemo(() => filterTree(roots, search.trim().toLowerCase()), [roots, search]);
  const isExpanded = (id: string) => (search ? view.expand.has(id) : expanded.has(id));

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Cascade select: toggling a node toggles its whole subtree (select Gujarat →
  // all its cities become selected; unselect Gujarat → all clear).
  function toggleNode(node: TerritoryNode) {
    const ids = subtreeIds(node);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = (await assignEmployeeAreas(employeeId, [...selected])) as {
        ok: boolean; reason?: string; territory_name?: string; assigned?: number;
      };
      if (!res.ok) {
        if (res.reason === "area_taken") {
          toast.error(`"${res.territory_name}" is already assigned to another employee (area-wise mode allows one owner per area).`);
        } else {
          toast.error("Could not save assignments.");
        }
        return;
      }
      toast.success(`Assigned ${res.assigned ?? selected.size} area(s).`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6 border-border shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MapPin className="size-5 text-primary" /> Assigned Areas
        </h2>
        {settings && <Badge variant="outline">{settings.assignment_mode === "area_wise" ? "Area-wise" : "Direct"} mode</Badge>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : !settings || enabledLevels(settings).length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">
          The territory hierarchy isn&apos;t configured yet. An admin must enable levels under
          <span className="font-medium"> Settings → Territory → Hierarchy &amp; assignment</span> first.
        </p>
      ) : totalTerritories === 0 ? (
        <p className="text-sm text-muted-foreground py-6">
          No territories exist yet. Set them up under <span className="font-medium">Settings → Territory</span> before assigning areas.
        </p>
      ) : (
        <>
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search areas…" className="pl-8 h-9" />
          </div>

          <div className="max-h-96 overflow-y-auto rounded-md border border-border p-2">
            {view.nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No areas match your search.</p>
            ) : (
              view.nodes.map((n) => (
                <CheckNode
                  key={n.id}
                  node={n}
                  depth={0}
                  settings={settings}
                  canEdit={canEdit}
                  selected={selected}
                  isExpanded={isExpanded}
                  onToggleSelect={toggleNode}
                  onToggleExpand={toggleExpand}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground">
              {selected.size} area(s) selected. Selecting a parent selects everything under it.
            </span>
            {canEdit && (
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
                Save assignments
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function CheckNode({
  node,
  depth,
  settings,
  canEdit,
  selected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: {
  node: TerritoryNode;
  depth: number;
  settings: TerritorySettings;
  canEdit: boolean;
  selected: Set<string>;
  isExpanded: (id: string) => boolean;
  onToggleSelect: (node: TerritoryNode) => void;
  onToggleExpand: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = isExpanded(node.id);

  // checked = whole subtree selected; indeterminate = some (but not all) selected.
  const ids = subtreeIds(node);
  const selCount = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0);
  const fullyChecked = selCount === ids.length;
  const partiallyChecked = selCount > 0 && !fullyChecked;

  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 rounded hover:bg-muted/50" style={{ paddingLeft: depth * 18 + 2 }}>
        {hasChildren ? (
          <button type="button" onClick={() => onToggleExpand(node.id)} className="p-0.5 text-muted-foreground shrink-0" aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <label className="flex items-center gap-2 cursor-pointer min-w-0">
          <input
            type="checkbox"
            checked={fullyChecked}
            ref={(el) => { if (el) el.indeterminate = partiallyChecked; }}
            onChange={() => onToggleSelect(node)}
            disabled={!canEdit}
            className="size-4 shrink-0"
          />
          <span className="text-sm truncate">{node.name}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{levelName(settings, node.level)}</Badge>
        </label>
      </div>
      {open && node.children.map((c) => (
        <CheckNode
          key={c.id}
          node={c}
          depth={depth + 1}
          settings={settings}
          canEdit={canEdit}
          selected={selected}
          isExpanded={isExpanded}
          onToggleSelect={onToggleSelect}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}

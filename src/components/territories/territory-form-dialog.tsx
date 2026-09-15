"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { enabledLevels, levelName } from "@/lib/territories/settings";
import type { Territory, TerritorySettings } from "@/lib/territories/types";

export interface TerritoryFormValues {
  level: number;
  parentId: string | null;
  name: string;
  code: string;
  notes: string;
  status: "active" | "inactive";
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: TerritorySettings;
  rows: Territory[]; // active territories, for parent selection
  mode: "create" | "edit";
  editNode?: Territory;
  presetLevel?: number; // when adding a child from the tree
  presetParentPath?: string[]; // ancestor ids (root → parent) when adding a child
  busy: boolean;
  onSubmit: (values: TerritoryFormValues) => void;
}

/** ancestor id chain (root → parent), excluding the node itself. */
function ancestorChain(rows: Territory[], node: Territory): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain: string[] = [];
  let cur = node.parent_id ? byId.get(node.parent_id) : undefined;
  while (cur) {
    chain.unshift(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

export function TerritoryFormDialog({
  open,
  onClose,
  settings,
  rows,
  mode,
  editNode,
  presetLevel,
  presetParentPath,
  busy,
  onSubmit,
}: Props) {
  const enabled = useMemo(() => enabledLevels(settings), [settings]);
  const byIdAll = useMemo(() => {
    const m = new Map<string, Territory>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);

  // Full "Country / State / City" label for a node, walking up its parents.
  const pathLabel = (t: Territory) => {
    const parts: string[] = [];
    let cur: Territory | undefined = t;
    let guard = 0;
    while (cur && guard < 8) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byIdAll.get(cur.parent_id) : undefined;
      guard += 1;
    }
    return parts.join(" / ");
  };

  // Ancestor id chain (root → node itself) — used to set the whole parent path
  // from a single chosen parent, so picking a City fills in its State + Country.
  const chainOf = (id: string) => {
    const chain: string[] = [];
    let cur: Territory | undefined = byIdAll.get(id);
    let guard = 0;
    while (cur && guard < 8) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? byIdAll.get(cur.parent_id) : undefined;
      guard += 1;
    }
    return chain;
  };

  const parentsLocked = mode === "edit" || (mode === "create" && !!presetParentPath);

  const [level, setLevel] = useState<number>(enabled[0]?.position ?? 1);
  const [path, setPath] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  // (Re)initialise whenever the dialog opens or its target changes.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editNode) {
      setLevel(editNode.level);
      setPath(ancestorChain(rows, editNode));
      setName(editNode.name);
      setCode(editNode.code ?? "");
      setNotes(editNode.notes ?? "");
      setStatus(editNode.status === "inactive" ? "inactive" : "active");
    } else {
      setLevel(presetLevel ?? enabled[0]?.position ?? 1);
      setPath(presetParentPath ? [...presetParentPath] : []);
      setName("");
      setCode("");
      setNotes("");
      setStatus("active");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editNode, presetLevel]);

  const selectedIdx = enabled.findIndex((l) => l.position === level);
  const ancestorLevels = selectedIdx > 0 ? enabled.slice(0, selectedIdx) : [];

  function changeLevel(pos: number) {
    setLevel(pos);
    setPath([]); // ancestor chain depends on the level; reset
  }
  const parentId = ancestorLevels.length > 0 ? path[ancestorLevels.length - 1] ?? null : null;
  const parentsComplete = ancestorLevels.every((_, i) => !!path[i]);
  const canSubmit = !!name.trim() && parentsComplete && !busy;

  function submit() {
    onSubmit({ level, parentId, name: name.trim(), code: code.trim(), notes: notes.trim(), status });
  }

  const title =
    mode === "edit"
      ? `Edit ${levelName(settings, level)}`
      : `Add ${levelName(settings, level)}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Levels use the names from Territory → Hierarchy &amp; assignment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Level */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Level</Label>
            <div className="flex flex-wrap gap-3">
              {enabled.map((l) => (
                <label key={l.position} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="territory-level"
                    checked={level === l.position}
                    onChange={() => changeLevel(l.position)}
                    disabled={mode === "edit"}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter name…" autoFocus />
          </div>

          {/* Parent — a single searchable picker of the level directly above the
              one being created, labelled by full path ("India / Gujarat / Rajkot").
              Picking it fills in the whole ancestor chain, so you don't have to
              select Country → State → City top-down. */}
          {ancestorLevels.length > 0 && (() => {
            const parentLevel = ancestorLevels[ancestorLevels.length - 1];
            const parentOptions = rows
              .filter((r) => r.level === level - 1)
              .map((r) => ({ value: r.id, label: pathLabel(r) }))
              .sort((a, b) => a.label.localeCompare(b.label));
            const selectedParent = path[path.length - 1] ?? "";
            return (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {parentLevel.name} <span className="text-destructive">*</span>
                </Label>
                <SearchableSelect
                  options={parentOptions}
                  value={selectedParent}
                  onChange={(id) => setPath(id ? chainOf(id) : [])}
                  placeholder={`Select ${parentLevel.name.toLowerCase()}…`}
                  searchPlaceholder={`Search ${parentLevel.name.toLowerCase()}…`}
                  emptyMessage={`No ${parentLevel.name.toLowerCase()} found — create it first.`}
                  disabled={parentsLocked}
                />
                <p className="text-[11px] text-muted-foreground">
                  Pick the {parentLevel.name.toLowerCase()}; its parents are filled in automatically.
                </p>
              </div>
            );
          })()}

          {/* Code + Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Code (optional)</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. GJ" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="flex items-center gap-4 h-9">
                {(["active", "inactive"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer capitalize">
                    <input type="radio" name="territory-status" checked={status === s} onChange={() => setStatus(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy && <Loader2 className="size-4 mr-1 animate-spin" />}
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

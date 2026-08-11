"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { levelName } from "@/lib/territories/settings";
import type { Territory, TerritorySettings } from "@/lib/territories/types";

interface Props {
  rows: Territory[];              // flat, active territories for the account
  settings: TerritorySettings;
  value: string | null;          // selected leaf territory_id
  onChange: (territoryId: string | null) => void;
  onPathResolve?: (pathTerritories: Territory[]) => void;
  disabled?: boolean;
}

/** Dynamic cascade of dropdowns — one per hierarchy depth — driven entirely by the
 *  configured levels and the live tree. This is reversible: selecting a child
 *  automatically selects its parents. */
export function TerritoryPicker({ rows, settings, value, onChange, onPathResolve, disabled }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, Territory>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);

  const byLevel = useMemo(() => {
    const m = new Map<number, Territory[]>();
    rows.forEach((r) => {
      const lvl = r.level;
      if (!m.has(lvl)) m.set(lvl, []);
      m.get(lvl)!.push(r);
    });
    m.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [rows]);

  // path = selected ids from root down; derived from `value` on load/change.
  const [path, setPath] = useState<string[]>([]);
  
  useEffect(() => {
    if (!value || !byId.has(value)) {
      setPath([]);
      if (onPathResolve) onPathResolve([]);
      return;
    }
    const chain: string[] = [];
    const territories: Territory[] = [];
    let cur: Territory | undefined = byId.get(value);
    while (cur) {
      chain.unshift(cur.id);
      territories.unshift(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    setPath(chain);
    if (onPathResolve) onPathResolve(territories);
  }, [value, byId]); // omit onPathResolve from deps to avoid loops

  function handleSelect(depth: number, id: string) {
    if (!id) {
      // Cleared at `depth`. Keep everything above `depth`.
      const next = path.slice(0, depth);
      setPath(next);
      onChange(next.length ? next[next.length - 1] : null);
      return;
    }
    
    // User selected an item. Trace its parents.
    const chain: string[] = [];
    let cur: Territory | undefined = byId.get(id);
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    setPath(chain);
    onChange(chain[chain.length - 1]);
  }

  // Determine which levels to show based on settings
  const activeLevels = useMemo(() => {
    return settings.levels.filter(l => l.enabled).map(l => l.position);
  }, [settings]);

  if (activeLevels.length === 0) {
    return <p className="text-xs text-muted-foreground">No territories available. Set them up in Territory Master first.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {activeLevels.map((lvl, idx) => {
        const depth = idx;
        const parentId = depth === 0 ? null : path[depth - 1] ?? null;
        
        // Options for this level: 
        // If parent is selected, only children of parent.
        // If parent is NOT selected, all items at this level.
        let options = byLevel.get(lvl) ?? [];
        if (parentId) {
          options = options.filter(o => o.parent_id === parentId);
        }

        const selected = path[depth] ?? "";
        const label = levelName(settings, lvl);

        return (
          <div key={lvl} className="space-y-1">
            <Label className="text-muted-foreground text-xs">{label}</Label>
            <SearchableSelect
              value={selected}
              onChange={(val) => handleSelect(depth, val)}
              options={options.map((o) => ({ label: o.name, value: o.id }))}
              placeholder={`Select ${label.toLowerCase()}…`}
            />
          </div>
        );
      })}
    </div>
  );
}

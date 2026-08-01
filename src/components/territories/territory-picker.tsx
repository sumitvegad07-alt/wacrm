"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { levelName } from "@/lib/territories/settings";
import type { Territory, TerritorySettings } from "@/lib/territories/types";

interface Props {
  rows: Territory[];              // flat, active territories for the account
  settings: TerritorySettings;
  value: string | null;          // selected leaf territory_id
  onChange: (territoryId: string | null) => void;
  disabled?: boolean;
}

/** Dynamic cascade of dropdowns — one per hierarchy depth — driven entirely by the
 *  configured levels and the live tree (no hardcoded country/state/city fields).
 *  The selected value is the deepest chosen level (partial selection allowed). */
export function TerritoryPicker({ rows, settings, value, onChange, disabled }: Props) {
  const byId = useMemo(() => {
    const m = new Map<string, Territory>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, Territory[]>();
    rows.forEach((r) => {
      const key = r.parent_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    });
    m.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [rows]);

  // path = selected ids from root down; derived from `value` on load/change.
  const [path, setPath] = useState<string[]>([]);
  useEffect(() => {
    if (!value || !byId.has(value)) {
      setPath([]);
      return;
    }
    const chain: string[] = [];
    let cur: Territory | undefined = byId.get(value);
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    setPath(chain);
  }, [value, byId]);

  function selectAt(depth: number, id: string) {
    const next = path.slice(0, depth);
    if (id) next.push(id);
    setPath(next);
    onChange(next.length ? next[next.length - 1] : null);
  }

  // Build the list of selects: depth 0 = roots, then children of each selection.
  const selects: { depth: number; parentId: string | null; options: Territory[]; selected: string }[] = [];
  for (let d = 0; ; d++) {
    const parentId = d === 0 ? null : path[d - 1] ?? null;
    if (d > 0 && !path[d - 1]) break;
    const options = childrenOf.get(parentId) ?? [];
    if (options.length === 0) break;
    selects.push({ depth: d, parentId, options, selected: path[d] ?? "" });
  }

  if (selects.length === 0) {
    return <p className="text-xs text-muted-foreground">No territories available. Set them up in Territory Master first.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {selects.map((s) => {
        const label = levelName(settings, s.options[0].level);
        return (
          <div key={s.depth} className="space-y-1">
            <Label className="text-muted-foreground text-xs">{label}</Label>
            <select
              value={s.selected}
              disabled={disabled}
              onChange={(e) => selectAt(s.depth, e.target.value)}
              className="w-full h-9 rounded-md bg-muted border border-border text-foreground text-sm px-3 disabled:opacity-60"
            >
              <option value="">Select {label.toLowerCase()}…</option>
              {s.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExistingMaster,
  ImportDescriptor,
  LookupDescriptor,
  LookupResolveGroup,
  ResolveSelections,
  RowValidation,
} from "./types";

// Guided Resolve: detect lookup values in the file that don't exist as masters
// yet (unknown territories/categories/…), so the admin decides ONCE per distinct
// value — Create / Map to existing / Leave blank — BEFORE any record is written.
// Hierarchical masters (territories, categories) also let the admin pick the
// parent when creating, so a new "Gondal Road" lands under "Rajkot", not at the top.

async function loadExistingMaster(
  supabase: SupabaseClient,
  lk: LookupDescriptor,
  accountId: string,
): Promise<ExistingMaster[]> {
  const nameCol = lk.matchColumns[0];
  const cols = lk.hierarchical ? `id, ${nameCol}, parent_id, level` : `id, ${nameCol}`;
  const raw: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(lk.table).select(cols).eq("account_id", accountId).range(from, from + PAGE - 1);
    if (lk.table === "territories") q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    raw.push(...rows);
    if (rows.length < PAGE) break;
  }

  const base: ExistingMaster[] = raw.map((r) => ({
    id: String(r.id),
    name: String(r[nameCol] ?? ""),
    level: lk.hierarchical ? (r.level as number) : undefined,
    parentId: lk.hierarchical ? ((r.parent_id as string) ?? null) : undefined,
  }));

  // Build "India / Gujarat / Rajkot" paths so the admin can pick the right node
  // (names repeat across branches).
  if (lk.hierarchical) {
    const byId = new Map(base.map((m) => [m.id, m]));
    const pathOf = (m: ExistingMaster, guard = 0): string => {
      if (!m.parentId || guard > 12) return m.name;
      const parent = byId.get(m.parentId);
      return parent ? `${pathOf(parent, guard + 1)} / ${m.name}` : m.name;
    };
    for (const m of base) m.path = pathOf(m);
    base.sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
  } else {
    base.sort((a, b) => a.name.localeCompare(b.name));
  }
  return base;
}

/** Find, per lookup field, the distinct file values that have no matching master. */
export async function detectUnknownLookups(
  supabase: SupabaseClient,
  descriptor: ImportDescriptor,
  rows: RowValidation[],
  accountId: string,
): Promise<LookupResolveGroup[]> {
  if (!descriptor.lookups?.length) return [];
  const fieldByKey = new Map(descriptor.fields.map((f) => [f.key, f]));
  const groups: LookupResolveGroup[] = [];

  for (const lk of descriptor.lookups) {
    const field = fieldByKey.get(lk.field);
    if (!field) continue;

    const counts = new Map<string, { value: string; count: number }>();
    for (const r of rows) {
      if (r.status === "invalid") continue;
      const raw = (r.values[lk.field] ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const e = counts.get(key);
      if (e) e.count += 1;
      else counts.set(key, { value: raw, count: 1 });
    }
    if (counts.size === 0) continue;

    const existing = await loadExistingMaster(supabase, lk, accountId);
    const existingLower = new Set(existing.map((e) => e.name.trim().toLowerCase()));

    const unknowns = [...counts.values()]
      .filter((u) => !existingLower.has(u.value.toLowerCase()))
      .sort((a, b) => b.count - a.count);
    if (unknowns.length === 0) continue;

    groups.push({
      field: lk.field,
      label: field.label,
      table: lk.table,
      createable: lk.createable,
      hierarchical: !!lk.hierarchical,
      existing,
      unknowns,
    });
  }
  return groups;
}

/**
 * Apply the admin's resolutions: create the masters they chose to create (under
 * the chosen parent for hierarchical ones), then return a rewrite map (field →
 * lowercased original value → new value) used to rewrite each row before commit.
 */
export async function applyResolutions(
  supabase: SupabaseClient,
  groups: LookupResolveGroup[],
  selections: ResolveSelections,
  accountId: string,
  canCreate: boolean,
): Promise<{ rewrite: Record<string, Record<string, string>>; created: number; errors: string[] }> {
  const rewrite: Record<string, Record<string, string>> = {};
  let created = 0;
  const errors: string[] = [];

  for (const g of groups) {
    rewrite[g.field] = rewrite[g.field] ?? {};
    const byId = new Map(g.existing.map((e) => [e.id, e]));
    // Rows to insert: name + optional parent/level. One insert per group.
    const inserts: { account_id: string; name: string; parent_id?: string | null; level?: number }[] = [];

    for (const u of g.unknowns) {
      const key = u.value.toLowerCase();
      const sel = selections[g.field]?.[key] ?? defaultAction(g, canCreate);
      if (sel.type === "map") {
        rewrite[g.field][key] = sel.toName;
      } else if (sel.type === "create" && g.createable === "admin" && canCreate) {
        rewrite[g.field][key] = u.value; // stays the same; exists after insert
        if (g.hierarchical) {
          const parent = sel.parentId ? byId.get(sel.parentId) : undefined;
          inserts.push({
            account_id: accountId,
            name: u.value,
            parent_id: parent?.id ?? null,
            level: (parent?.level ?? 0) + 1,
          });
        } else {
          inserts.push({ account_id: accountId, name: u.value });
        }
      } else {
        rewrite[g.field][key] = ""; // blank / not creatable
      }
    }

    if (inserts.length) {
      const { error } = await supabase.from(g.table).insert(inserts);
      if (error) {
        errors.push(`Could not create ${g.label}: ${error.message}`);
        for (const ins of inserts) rewrite[g.field][ins.name.toLowerCase()] = "";
      } else {
        created += inserts.length;
      }
    }
  }
  return { rewrite, created, errors };
}

function defaultAction(g: LookupResolveGroup, canCreate: boolean) {
  return g.createable === "admin" && canCreate ? ({ type: "create" } as const) : ({ type: "blank" } as const);
}

/** Rewrite each row's lookup values in place per the resolution map. */
export function rewriteRows(rows: RowValidation[], rewrite: Record<string, Record<string, string>>): void {
  for (const r of rows) {
    if (r.status === "invalid") continue;
    for (const field of Object.keys(rewrite)) {
      const raw = (r.values[field] ?? "").trim();
      if (!raw) continue;
      const mapped = rewrite[field][raw.toLowerCase()];
      if (mapped !== undefined) r.values[field] = mapped;
    }
  }
}

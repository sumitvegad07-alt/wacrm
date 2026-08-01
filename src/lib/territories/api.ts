// Territory Master — client data layer. Follows the repo's "talk to Supabase
// directly via createClient()" pattern (see CLAUDE Web.md). Simple reads/writes
// are plain queries (RLS-enforced); anything needing server logic or a
// confirmation payload goes through the SECURITY DEFINER RPCs in migration 102/103.

import { createClient } from '@/lib/supabase/client';
import type { Territory, TerritoryNode, TerritoryLevel, AssignmentMode } from './types';
import { normalizeTerritorySettings } from './settings';

const TERRITORY_COLS =
  'id, account_id, parent_id, level, name, code, status, notes, is_seed_data, created_at, updated_at, deleted_at';

// ── reads ─────────────────────────────────────────────────────
/** All territories for an account (active by default), nested into a tree. */
export async function getTerritoryTree(
  accountId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<TerritoryNode[]> {
  return buildTree(await getTerritoryRows(accountId, opts));
}

/** Flat rows, paginated past PostgREST's per-request row cap (the default seed
 *  alone is 1047 rows > the 1000-row cap), so the whole tree always loads. */
export async function getTerritoryRows(
  accountId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<Territory[]> {
  const supabase = createClient();
  const PAGE = 1000;
  const all: Territory[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from('territories')
      .select(TERRITORY_COLS)
      .eq('account_id', accountId)
      .order('level', { ascending: true })
      .order('name', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!opts.includeArchived) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Territory[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/** Build an adjacency-list array into a nested tree. Orphans (parent filtered
 *  out, e.g. archived) surface at the root so nothing is silently hidden. */
export function buildTree(rows: Territory[]): TerritoryNode[] {
  const byId = new Map<string, TerritoryNode>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  const roots: TerritoryNode[] = [];
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export async function getAccountTerritorySettings(accountId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
  if (error) throw error;
  return normalizeTerritorySettings((data?.settings as Record<string, unknown> | null)?.territory_settings);
}

// ── create / update (plain writes; RLS admin-gated) ───────────
export interface CreateTerritoryInput {
  accountId: string;
  parentId: string | null;
  level: number;
  name: string;
  code?: string | null;
  notes?: string | null;
  status?: 'active' | 'inactive';
}

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate' | 'error'; message?: string };

const UNIQUE_VIOLATION = '23505';

export async function createTerritory(input: CreateTerritoryInput): Promise<WriteResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('territories')
    .insert({
      account_id: input.accountId,
      parent_id: input.parentId,
      level: input.level,
      name: input.name.trim(),
      code: input.code?.trim() || null,
      notes: input.notes?.trim() || null,
      status: input.status ?? 'active',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'duplicate' };
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true, id: data.id };
}

export async function updateTerritory(
  id: string,
  fields: { name?: string; code?: string | null; notes?: string | null; status?: 'active' | 'inactive' }
): Promise<WriteResult> {
  const supabase = createClient();
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name.trim();
  if (fields.code !== undefined) patch.code = fields.code?.trim() || null;
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null;
  if (fields.status !== undefined) patch.status = fields.status;
  const { error } = await supabase.from('territories').update(patch).eq('id', id).select('id').single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'duplicate' };
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true, id };
}

// ── RPC wrappers ──────────────────────────────────────────────
async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const archiveTerritory = (id: string, force = false) =>
  rpc('territory_archive', { p_id: id, p_force: force });
export const restoreTerritory = (id: string) => rpc('territory_restore', { p_id: id });
export const deleteTerritory = (id: string) => rpc('territory_delete', { p_id: id });
export const assignEmployeeAreas = (employeeId: string, territoryIds: string[]) =>
  rpc('territory_assign_employee_areas', { p_employee_id: employeeId, p_territory_ids: territoryIds });
export const updateTerritorySettings = (
  accountId: string,
  levels: TerritoryLevel[],
  assignmentMode: AssignmentMode,
  confirm = false
) =>
  rpc('territory_update_settings', {
    p_account_id: accountId,
    p_levels: levels,
    p_assignment_mode: assignmentMode,
    p_confirm: confirm,
  });
export const migrateContactGeo = (accountId: string) =>
  rpc('territory_migrate_contact_geo', { p_account_id: accountId });

/** How many customers still have old typed-in country/state/city/area but no
 *  territory yet — i.e. the migration tool has something to do. 0 → hide it. */
export async function countMigratableContacts(accountId: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('territory_id', null)
    .or('country.not.is.null,state.not.is.null,city.not.is.null,area.not.is.null');
  return count ?? 0;
}

export async function getEmployeeAssignedAreas(employeeId: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('employee_area_assignments')
    .select('territory_id')
    .eq('employee_id', employeeId);
  if (error) throw error;
  return (data ?? []).map((r) => r.territory_id as string);
}

/** Load the pinned seed dataset (dynamically, keeping it out of the main bundle)
 *  and hand it to the idempotent territory_bulk_seed RPC. */
export async function seedDefaultTerritories(accountId: string) {
  const { SEED_COUNTRIES, SEED_INDIA_STATES, SEED_INDIA_DISTRICTS } = await import(
    './seed-data.generated'
  );
  return rpc('territory_bulk_seed', {
    p_account_id: accountId,
    p_countries: SEED_COUNTRIES,
    p_states: SEED_INDIA_STATES,
    p_districts: SEED_INDIA_DISTRICTS,
  });
}

// ── CSV import / export ───────────────────────────────────────
// CSV shape: parent_path,name,code,notes
//   parent_path = slash-joined ancestor names ("" for a root), e.g. "India/Gujarat".
//   Level is derived from parent_path depth + 1.

const CSV_HEADER = 'parent_path,name,code,notes';

function csvEscape(v: string | null): string {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal RFC-4180-ish parser (hand-rolled — no papaparse dependency in this repo). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Pure tree → CSV (parent_path,name,code,notes). Exported for testing. */
export function treeToCsv(tree: TerritoryNode[]): string {
  const lines: string[] = [CSV_HEADER];
  const walk = (node: TerritoryNode, ancestors: string[]) => {
    lines.push(
      [csvEscape(ancestors.join('/')), csvEscape(node.name), csvEscape(node.code), csvEscape(node.notes)].join(',')
    );
    node.children.forEach((ch) => walk(ch, [...ancestors, node.name]));
  };
  tree.forEach((root) => walk(root, []));
  return lines.join('\n');
}

export async function bulkExportTerritories(accountId: string): Promise<string> {
  return treeToCsv(await getTerritoryTree(accountId));
}

export interface ImportRowError { row: number; reason: string }
export interface ImportResult { success: number; errors: ImportRowError[] }

/** Import a CSV. Resolves each row's parent by walking parent_path names against
 *  the (live-refreshed) tree, so parents created earlier in the same import are
 *  visible to later rows. Per-row errors are collected, not thrown. */
export async function bulkImportTerritories(accountId: string, csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  const errors: ImportRowError[] = [];
  let success = 0;
  if (rows.length === 0) return { success, errors };

  // Header detection (optional).
  const start = rows[0].map((c) => c.trim().toLowerCase()).join(',') === CSV_HEADER ? 1 : 0;

  const settings = await getAccountTerritorySettings(accountId);
  // path (lowercased, slash-joined) -> territory id, seeded from existing tree.
  const idByPath = new Map<string, string>();
  const seed = (node: TerritoryNode, ancestors: string[]) => {
    const path = [...ancestors, node.name].map((s) => s.toLowerCase()).join('/');
    idByPath.set(path, node.id);
    node.children.forEach((ch) => seed(ch, [...ancestors, node.name]));
  };
  (await getTerritoryTree(accountId)).forEach((r) => seed(r, []));

  for (let i = start; i < rows.length; i++) {
    const rowNum = i + 1;
    const [parentPathRaw = '', nameRaw = '', codeRaw = '', notesRaw = ''] = rows[i];
    const name = nameRaw.trim();
    const parentPath = parentPathRaw.trim();
    if (!name) { errors.push({ row: rowNum, reason: 'Missing name' }); continue; }

    const ancestorNames = parentPath ? parentPath.split('/').map((s) => s.trim()).filter(Boolean) : [];
    const level = ancestorNames.length + 1;

    if (!settings.levels.some((l) => l.position === level && l.enabled)) {
      errors.push({ row: rowNum, reason: `Level ${level} is not an enabled hierarchy level` });
      continue;
    }

    let parentId: string | null = null;
    if (ancestorNames.length > 0) {
      const parentKey = ancestorNames.map((s) => s.toLowerCase()).join('/');
      parentId = idByPath.get(parentKey) ?? null;
      if (!parentId) { errors.push({ row: rowNum, reason: `Parent path not found: "${parentPath}"` }); continue; }
    }

    const res = await createTerritory({ accountId, parentId, level, name, code: codeRaw, notes: notesRaw });
    if (res.ok) {
      success++;
      const key = [...ancestorNames.map((s) => s.toLowerCase()), name.toLowerCase()].join('/');
      idByPath.set(key, res.id);
    } else if (res.reason === 'duplicate') {
      errors.push({ row: rowNum, reason: `Duplicate name "${name}" under the same parent` });
    } else {
      errors.push({ row: rowNum, reason: res.message ?? 'Insert failed' });
    }
  }
  return { success, errors };
}

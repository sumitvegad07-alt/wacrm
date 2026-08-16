import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDefaultConfig,
  normalizeConfig,
  type DocumentModule,
  type DocumentTemplateConfig,
} from './schema';

export interface DocumentTemplateSummary {
  id: string;
  name: string;
  moduleName: DocumentModule;
  isDefault: boolean;
  updatedAt: string;
}

export interface DocumentTemplate extends DocumentTemplateSummary {
  config: DocumentTemplateConfig;
}

const COLUMNS = 'id, name, module_name, is_default, config, updated_at';

function toTemplate(row: any): DocumentTemplate {
  const moduleName = row.module_name as DocumentModule;
  return {
    id: row.id,
    name: row.name,
    moduleName,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
    // Always normalised on the way out, so no caller ever handles a partial config.
    config: normalizeConfig(moduleName, row.config),
  };
}

export async function listTemplates(
  supabase: SupabaseClient,
  accountId: string,
  module: DocumentModule
): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('module_name', module)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toTemplate);
}

export async function getTemplate(
  supabase: SupabaseClient,
  id: string
): Promise<DocumentTemplate | null> {
  const { data, error } = await supabase
    .from('document_templates')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTemplate(data) : null;
}

export async function createTemplate(
  supabase: SupabaseClient,
  accountId: string,
  module: DocumentModule,
  name: string,
  config: DocumentTemplateConfig,
  userId?: string
): Promise<DocumentTemplate> {
  // The first template in a module becomes its default, otherwise printing an order would
  // silently fall back to built-in defaults while the user's only template sat unused.
  const { count } = await supabase
    .from('document_templates')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('module_name', module);

  const { data, error } = await supabase
    .from('document_templates')
    .insert({
      account_id: accountId,
      module_name: module,
      name: name.trim(),
      config,
      is_default: (count ?? 0) === 0,
      created_by: userId ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toTemplate(data);
}

export async function updateTemplate(
  supabase: SupabaseClient,
  id: string,
  name: string,
  config: DocumentTemplateConfig
): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .update({ name: name.trim(), config })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return toTemplate(data);
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('document_templates').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Promoted through an RPC rather than two updates from the browser: the unique index allows
 * only one default per module, so unsetting the old one and setting the new one has to
 * happen together or a module can end up with none.
 */
export async function setDefaultTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_document_template', { p_template_id: id });
  if (error) throw error;
}

/**
 * The config a document should print with, for the current viewer.
 *
 * Precedence, resolved in one round trip by `resolve_document_template`:
 *   1. a template assigned to this user
 *   2. the account default
 *   3. the module's built-in defaults
 *
 * Step 3 is why an account that has never opened the editor still prints a sensible
 * document rather than an empty page.
 */
export async function resolveTemplateConfig(
  supabase: SupabaseClient,
  accountId: string,
  module: DocumentModule,
  userId?: string | null
): Promise<DocumentTemplateConfig> {
  const { data, error } = await supabase.rpc('resolve_document_template', {
    p_account_id: accountId,
    p_module: module,
    p_user_id: userId ?? null,
  });

  if (error || !data) return buildDefaultConfig(module);
  return normalizeConfig(module, data);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface TemplateAssignee {
  userId: string;
  name: string;
}

export interface AccountUser {
  userId: string;
  name: string;
  /** The template this user already holds for the module, if any. */
  assignedTemplateId: string | null;
  assignedTemplateName: string | null;
}

/**
 * Everyone in the account, with whichever template they already hold for this module.
 *
 * A user may hold at most one template per module (enforced by a unique index), so the UI
 * has to show what assigning would replace rather than letting the save fail.
 */
export async function listAssignableUsers(
  supabase: SupabaseClient,
  accountId: string,
  module: DocumentModule
): Promise<AccountUser[]> {
  const [{ data: profiles }, { data: assignments }] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .eq('account_id', accountId)
      .order('full_name'),
    supabase
      .from('document_template_assignments')
      .select('user_id, template_id, document_templates(name)')
      .eq('account_id', accountId)
      .eq('module_name', module),
  ]);

  const byUser = new Map<string, { id: string; name: string }>();
  for (const a of assignments ?? []) {
    byUser.set((a as any).user_id, {
      id: (a as any).template_id,
      name: (a as any).document_templates?.name ?? 'a template',
    });
  }

  return (profiles ?? []).map((p: any) => {
    const held = byUser.get(p.user_id);
    return {
      userId: p.user_id,
      name: p.full_name || p.email || 'Unnamed user',
      assignedTemplateId: held?.id ?? null,
      assignedTemplateName: held?.name ?? null,
    };
  });
}

export async function assignTemplate(
  supabase: SupabaseClient,
  templateId: string,
  userId: string,
  accountId: string,
  module: DocumentModule
): Promise<void> {
  // One template per user per module. Clearing the previous holding first turns what would
  // be a unique-violation into the reassignment the admin actually meant.
  await supabase
    .from('document_template_assignments')
    .delete()
    .eq('account_id', accountId)
    .eq('module_name', module)
    .eq('user_id', userId);

  const { error } = await supabase.from('document_template_assignments').insert({
    template_id: templateId,
    user_id: userId,
    // account_id and module_name are overwritten from the template by a trigger; sent only
    // because the columns are NOT NULL.
    account_id: accountId,
    module_name: module,
  });

  if (error) throw error;
}

export async function unassignTemplate(
  supabase: SupabaseClient,
  templateId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('document_template_assignments')
    .delete()
    .eq('template_id', templateId)
    .eq('user_id', userId);

  if (error) throw error;
}

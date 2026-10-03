// Asset history — the rows written to `module_activities` and read back by the detail screen's
// Timeline tab. The row shaping is pure (tested); the one write is a fire-and-forget.
//
// Matches how the other modules log (src/lib/activities.ts): `module_name` is a singular noun
// (`contact`, `order`, `product` ... here `customer_asset`), `action` is a short verb, `message` is
// the sentence the Timeline shows, `details` is free JSON.
//
// THE ID TRAP: module_activities.user_id is a foreign key to auth.users(id), NOT profiles.id. The
// two id spaces differ in this codebase and mixing them is a recorded, repeated bug class. The id
// written here is `session.user.id`, which is the auth id by definition.

import type { SupabaseClient } from '@supabase/supabase-js';

export const ASSET_ACTIVITY_MODULE = 'customer_asset';

export type AssetActivityAction = 'created' | 'updated' | 'archived' | 'restored';

/** The part of a saved asset row the log needs. */
export interface LoggedAsset {
  id: string;
  account_id: string;
  asset_code: string;
  name: string;
}

export type AssetActivityEvent =
  | { kind: 'created'; asset: LoggedAsset }
  /** `changed` is the payload keys that were written (column names). */
  | { kind: 'updated'; asset: LoggedAsset; changed: readonly string[] }
  | { kind: 'archived'; asset: LoggedAsset }
  /** `recoded`: the restore also gave the asset a new code (the old one had been reissued). */
  | { kind: 'restored'; asset: LoggedAsset; recoded: boolean };

export interface AssetActivityRow {
  account_id: string;
  user_id: string;
  module_name: typeof ASSET_ACTIVITY_MODULE;
  record_id: string;
  action: AssetActivityAction;
  message: string;
  details: Record<string, unknown>;
}

/** Column name -> what a person would call it. Anything not listed is not named in the message. */
const FIELD_LABEL: Record<string, string> = {
  contact_id: 'customer',
  name: 'name',
  asset_type_id: 'asset type',
  product_id: 'product',
  make: 'make',
  model_no: 'model number',
  serial_no: 'serial number',
  installation_date: 'installation date',
  warranty_start: 'warranty start',
  warranty_end: 'warranty end',
  status: 'status',
  site_label: 'site label',
  territory_id: 'territory',
  notes: 'notes',
};

/** "a" / "a and b" / "a, b and c". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "Updated serial number and notes". Falls back to a plain sentence when no changed field is one we name. */
export function describeUpdate(changed: readonly string[]): string {
  const labels = [...new Set(changed.map((k) => FIELD_LABEL[k]).filter((l): l is string => Boolean(l)))];
  return labels.length > 0 ? `Updated ${joinWords(labels)}` : 'Asset updated';
}

export function buildAssetActivity(event: AssetActivityEvent, userId: string): AssetActivityRow {
  const { asset } = event;
  const base = {
    account_id: asset.account_id,
    user_id: userId,
    module_name: ASSET_ACTIVITY_MODULE,
    record_id: asset.id,
  } as const;
  const details = { asset_code: asset.asset_code, name: asset.name };

  switch (event.kind) {
    case 'created':
      return { ...base, action: 'created', message: `Asset ${asset.asset_code} created`, details };
    case 'updated':
      return {
        ...base,
        action: 'updated',
        message: describeUpdate(event.changed),
        details: { ...details, changed_fields: [...event.changed] },
      };
    case 'archived':
      return { ...base, action: 'archived', message: 'Moved to Inactive', details };
    case 'restored':
      return {
        ...base,
        action: 'restored',
        message: event.recoded ? `Re-activated with new code ${asset.asset_code}` : 'Re-activated',
        details: event.recoded ? { ...details, recoded: true } : details,
      };
  }
}

/**
 * Record one event. Fire-and-forget by design: it returns nothing to await, never throws, and a
 * failure (no session, RLS, network) is swallowed with a console warning. An activity log must never
 * delay or fail the save it describes, which is why every record form in this repo runs its log
 * beside, not before, the write.
 *
 * Call it AFTER the write has succeeded, passing the row the write returned.
 */
export function logAssetActivity(supabase: SupabaseClient, event: AssetActivityEvent): void {
  void (async () => {
    try {
      // getSession reads the local session (no network round trip), unlike getUser.
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id; // auth.users.id, the column's real foreign key
      if (!userId) return;
      const { error } = await supabase.from('module_activities').insert(buildAssetActivity(event, userId));
      if (error) console.warn('[assets] could not log activity:', error.message);
    } catch (err) {
      console.warn('[assets] could not log activity:', err);
    }
  })();
}

// ── Read ───────────────────────────────────────────────────────────────────────

/** One row of module_activities, as the shared Timeline reads it. */
export interface AssetActivity {
  id: string;
  /** auth.users.id of whoever did it (the Timeline resolves it to a name), or null. */
  user_id: string | null;
  module_name: string;
  record_id: string;
  action: string;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** The most entries one asset's Timeline loads. Generous: an asset is edited rarely. */
export const ASSET_ACTIVITY_LIMIT = 200;

/**
 * An asset's history, newest first. Scoped to the account in SQL as well as by RLS (which admits every
 * account the caller belongs to). Throws on a database error; the caller decides how to degrade.
 */
export async function listAssetActivity(
  supabase: SupabaseClient,
  assetId: string,
  accountId: string,
  limit: number = ASSET_ACTIVITY_LIMIT,
): Promise<AssetActivity[]> {
  const { data, error } = await supabase
    .from('module_activities')
    .select('id, user_id, module_name, record_id, action, message, details, created_at')
    .eq('account_id', accountId)
    .eq('module_name', ASSET_ACTIVITY_MODULE)
    .eq('record_id', assetId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AssetActivity[];
}

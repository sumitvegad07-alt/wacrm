// Asset screens — the few calls a CLIENT component makes. Binds the browser Supabase client (the
// signed-in user's session, so RLS applies) to the injected-client functions in api.ts and
// lookups.ts, so components do not import the Supabase client themselves.

import { createClient } from '@/lib/supabase/client';
import {
  archiveAsset,
  createAsset,
  restoreAsset,
  updateAsset,
  type CreateAssetInput,
  type UpdateAssetInput,
} from './api';
import { searchCustomers, type CustomerOption } from './lookups';

export type { CustomerOption } from './lookups';

export const archiveAssetAsUser = (id: string) => archiveAsset(createClient(), id);

/** Plain restore, or restore WITH a new code when the old one was reissued to another asset. */
export const restoreAssetAsUser = (id: string, opts: { newCode?: string } = {}) =>
  restoreAsset(createClient(), id, opts);

export const searchCustomersAsUser = (term: string): Promise<CustomerOption[]> =>
  searchCustomers(createClient(), term);

export const createAssetAsUser = (input: CreateAssetInput) => createAsset(createClient(), input);

export const updateAssetAsUser = (id: string, input: UpdateAssetInput) => updateAsset(createClient(), id, input);

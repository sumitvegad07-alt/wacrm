import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AssetForm } from "@/components/service/asset-form";
import { getAsset, type AssetDetail } from "@/lib/service/assets/api";
import { AssetError } from "@/lib/service/assets/errors";
import { loadAssetFormLookups } from "@/lib/service/assets/lookups";
import { resolveServiceAssetsAccess } from "@/lib/service/require-access";

export const metadata: Metadata = {
  title: "Edit Asset",
};

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  // Re-checked here (the layout already did): layouts do not re-render on client navigation.
  const access = await resolveServiceAssetsAccess();
  if (!access.ok) redirect(access.redirectTo);
  const { supabase, accountId } = access.ctx;

  const { id } = await params;

  const [asset, lookups] = await Promise.all([
    // A malformed id (hand-typed URL) is a 22P02, which the data layer reports as 'validation':
    // that is "no such asset", not a fault. Anything else is a real failure and reaches the error boundary.
    getAsset(supabase, id).catch((err: unknown): AssetDetail | null => {
      if (err instanceof AssetError && err.kind === "validation") return null;
      throw err;
    }),
    loadAssetFormLookups(supabase, accountId),
  ]);

  // RLS admits every account the user belongs to; this page's pickers are loaded for the CURRENT
  // one, so an asset of another account must not open here.
  if (!asset || asset.account_id !== accountId) notFound();

  return <AssetForm asset={asset} accountId={accountId} lookups={lookups} />;
}

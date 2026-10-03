import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Wrench } from "lucide-react";

import { AssetDetailHeader } from "@/components/service/asset-detail-header";
import { AssetDetailTabs } from "@/components/service/asset-detail-tabs";
import { AssetDetails } from "@/components/service/asset-details";
import { AssetTimeline } from "@/components/service/asset-timeline";
import { EmptyState, PageLayout } from "@/components/shared";
import { listAssetActivity, type AssetActivity } from "@/lib/service/assets/activity";
import { getAsset, type AssetDetail } from "@/lib/service/assets/api";
import {
  assetActionGates,
  buildDetailGroups,
  creationSnapshotNote,
  customerDisplay,
} from "@/lib/service/assets/detail-view";
import { AssetError } from "@/lib/service/assets/errors";
import { resolveServiceAssetsAccess } from "@/lib/service/require-access";
import { warrantyState } from "@/lib/service/settings";

export const metadata: Metadata = {
  title: "Asset",
};

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Re-checked here (the layout already did): layouts do not re-render on client navigation.
  const access = await resolveServiceAssetsAccess();
  if (!access.ok) redirect(access.redirectTo);
  const { supabase, accountId } = access.ctx;

  const { id } = await params;

  // The asset and its history load together. History is the less important of the two: if it fails
  // the page still renders and the Timeline tab says so, instead of the whole screen erroring.
  const [asset, activities] = await Promise.all([
    // A malformed id (hand-typed URL) is a 22P02, which the data layer reports as 'validation':
    // that is "no such asset", not a fault. Anything else is a real failure and reaches the error boundary.
    getAsset(supabase, id).catch((err: unknown): AssetDetail | null => {
      if (err instanceof AssetError && err.kind === "validation") return null;
      throw err;
    }),
    listAssetActivity(supabase, id, accountId).catch((err: unknown): AssetActivity[] | null => {
      // 22P02 is the same hand-typed id; the page is about to 404, so it is not worth a log line.
      if ((err as { code?: string } | null)?.code !== "22P02") console.error("[service/assets] history failed:", err);
      return null;
    }),
  ]);

  // RLS admits every account the user belongs to; this screen belongs to the CURRENT one.
  if (!asset || asset.account_id !== accountId) notFound();

  const customer = customerDisplay(asset);
  const contactId = asset.contact && customer.source === "live" ? asset.contact_id : null;
  const archived = asset.deleted_at !== null;

  return (
    <PageLayout spacing="loose">
      <AssetDetailHeader
        assetId={asset.id}
        assetCode={asset.asset_code}
        name={asset.name}
        status={asset.status}
        archived={archived}
        warrantyEnd={asset.warranty_end}
        warranty={warrantyState(asset, new Date())}
        customer={{ label: customer.label, source: customer.source, contactId }}
        // The server's rights, never the browser's: a button the viewer cannot use is not rendered.
        gates={assetActionGates(access.rights, archived)}
      />

      <AssetDetailTabs
        details={
          <AssetDetails
            groups={buildDetailGroups(asset)}
            customer={{ source: customer.source, contactId }}
            snapshotNote={creationSnapshotNote(asset)}
          />
        }
        timeline={<AssetTimeline assetId={asset.id} activities={activities} />}
        jobs={
          <EmptyState
            icon={<Wrench className="size-6" />}
            title="Service history appears here once job management is enabled."
          />
        }
      />
    </PageLayout>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import type { AssetActivity } from "@/lib/service/assets/activity";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Timeline } from "@/components/shared/timeline";

export interface AssetTimelineProps {
  assetId: string;
  /** The asset's module_activities rows, newest first. Null when they could not be loaded. */
  activities: AssetActivity[] | null;
}

/**
 * The Timeline tab: the shared Timeline in history-only mode (an asset has no tasks or notes to
 * attach, so no ADD button), over the rows written by src/lib/service/assets/activity.ts.
 */
export function AssetTimeline({ assetId, activities }: AssetTimelineProps) {
  const router = useRouter();

  if (activities === null) {
    return (
      <Alert>
        <AlertTriangle className="size-4 text-amber-600" />
        <AlertTitle>Could not load the history</AlertTitle>
        <AlertDescription>The rest of this page is unaffected. Refresh the page to try again.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Timeline
      moduleName="customer_asset"
      recordId={assetId}
      tasks={[]}
      activities={activities}
      readOnly
      onRefresh={() => router.refresh()}
    />
  );
}

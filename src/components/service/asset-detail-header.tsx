import Link from "next/link";
import { AlertTriangle, ArrowLeft, UserRound } from "lucide-react";

import { assetStatusLabel } from "@/lib/service/assets/list-view";
import type { AssetActionGates, CustomerSource } from "@/lib/service/assets/detail-view";
import type { AssetStatus } from "@/lib/service/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/shared";
import { AssetActions } from "@/components/service/asset-actions";
import { WarrantyPill, type WarrantyPillState } from "@/components/service/warranty-pill";

export interface AssetDetailHeaderProps {
  assetId: string;
  assetCode: string;
  name: string;
  status: AssetStatus;
  /** Archived (soft-deleted) assets get a badge and a banner, and offer Restore instead of Archive. */
  archived: boolean;
  warrantyEnd: string | null;
  /** From `warrantyState(asset, today)`. Never re-derived here. */
  warranty: WarrantyPillState;
  customer: {
    /** The LIVE contact's name (or phone), or the snapshot when the contact is hidden. */
    label: string;
    source: CustomerSource;
    /** Only set when the live contact is readable; a hidden customer has nowhere to link to. */
    contactId: string | null;
  };
  gates: AssetActionGates;
}

const STATUS_VARIANT: Partial<Record<AssetStatus, "info">> = { under_repair: "info" };

/**
 * Title block of the asset detail screen: code and name, who the customer is (linked), the status
 * and warranty pills, and the actions. A Server Component; the buttons are the one client island.
 */
export function AssetDetailHeader({
  assetId,
  assetCode,
  name,
  status,
  archived,
  warrantyEnd,
  warranty,
  customer,
  gates,
}: AssetDetailHeaderProps) {
  return (
    <div className="space-y-3">
      <Link
        href="/service/assets"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> All assets
      </Link>

      {archived && (
        <Alert>
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle>This asset is archived</AlertTitle>
          <AlertDescription>
            It is hidden from the default asset list.
            {gates.restore ? " Press Restore to bring it back." : " Someone with permission to archive assets can restore it."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-sm font-medium text-foreground">
              {assetCode}
            </span>
            <h1 className="min-w-0 truncate text-xl font-semibold text-foreground">{name}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="size-3.5" aria-hidden />
              {customer.contactId && customer.source === "live" ? (
                <Link href={`/contacts/${customer.contactId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {customer.label}
                </Link>
              ) : (
                <span className="font-medium text-foreground">{customer.label}</span>
              )}
              {customer.source === "snapshot" && <span className="text-xs">(as recorded at creation)</span>}
            </p>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} label={assetStatusLabel(status)} variant={STATUS_VARIANT[status]} />
              {archived && <StatusBadge status="archived" label="Archived" />}
              <WarrantyPill state={warranty} endDate={warrantyEnd} />
            </div>
          </div>
        </div>

        <AssetActions assetId={assetId} assetCode={assetCode} assetName={name} gates={gates} />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

import type { AssetListRow } from "@/lib/service/assets/api";
import { listCustomerAssetsAsUser } from "@/lib/service/assets/browser";
import {
  PANEL_PAGE_SIZE,
  addAssetHref,
  assetHref,
  describePanelError,
  panelFooter,
  panelHeading,
  viewAllAssetsHref,
} from "@/lib/service/assets/customer-panel";
import { assetStatusLabel } from "@/lib/service/assets/list-view";
import { warrantyState } from "@/lib/service/settings";
import type { AssetStatus } from "@/lib/service/types";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import { WarrantyPill } from "@/components/service/warranty-pill";

const STATUS_VARIANT: Partial<Record<AssetStatus, "info">> = { under_repair: "info" };

export interface CustomerAssetsPanelProps {
  /** The customer's id (`contacts.id`). */
  contactId: string;
  /** The signed-in user's account id; scopes the read. */
  accountId: string;
  /** The user holds `create_service_assets`. Decides whether Add Asset is shown. */
  canCreate: boolean;
}

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: AssetListRow[]; total: number; loadedAt: Date };

/**
 * The customer's assets, on the customer detail page.
 *
 * This component does not decide whether it should exist: the customer page mounts it only when the
 * plan has the fsm line AND the user holds view_service_assets (see shouldShowCustomerAssets). A
 * tenant without the line therefore never mounts it and never reaches the effect below.
 *
 * Live assets only (archived rows are never requested), the first 25; "View all" carries the rest.
 */
export function CustomerAssetsPanel({ contactId, accountId, canCreate }: CustomerAssetsPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  // Bumped by Retry so the effect runs again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listCustomerAssetsAsUser(contactId, accountId, PANEL_PAGE_SIZE)
      .then(({ rows, total }) => {
        if (!cancelled) setState({ status: "ready", rows, total, loadedAt: new Date() });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[assets] customer panel could not load", err);
        setState({ status: "error", message: describePanelError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, accountId, attempt]);

  const total = state.status === "ready" ? state.total : 0;
  const shown = state.status === "ready" ? state.rows.length : 0;
  const footer = panelFooter(total, shown);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold mb-4">{panelHeading(total)}</h3>
        <div className="flex items-center gap-2">
          {footer.showViewAll && (
            <Link href={viewAllAssetsHref(contactId)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              View all
            </Link>
          )}
          {canCreate && (
            <Link href={addAssetHref(contactId)} className={buttonVariants({ size: "sm" })}>
              <Plus className="size-3.5" />
              Add Asset
            </Link>
          )}
        </div>
      </div>

      {state.status === "loading" && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading assets...
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-destructive">{state.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {state.status === "ready" && state.rows.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No assets recorded for this customer.</p>
      )}

      {state.status === "ready" && state.rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="font-medium py-2 pr-3">Code</th>
                  <th className="font-medium py-2 pr-3">Name</th>
                  <th className="font-medium py-2 pr-3">Type</th>
                  <th className="font-medium py-2 pr-3">Serial</th>
                  <th className="font-medium py-2 pr-3">Warranty</th>
                  <th className="font-medium py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Link href={assetHref(a.id)} className="font-mono text-xs text-primary hover:underline">
                        {a.asset_code}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 font-medium">
                      <Link href={assetHref(a.id)} className="hover:text-primary hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{a.asset_type?.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{a.serial_no ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <WarrantyPill state={warrantyState(a, state.loadedAt)} endDate={a.warranty_end} />
                    </td>
                    <td className="py-2">
                      <StatusBadge
                        status={a.status}
                        label={assetStatusLabel(a.status)}
                        variant={STATUS_VARIANT[a.status]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {footer.hiddenCount > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Showing the latest {shown} of {total}.{" "}
              <Link href={viewAllAssetsHref(contactId)} className="text-primary hover:underline">
                View all {total}
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

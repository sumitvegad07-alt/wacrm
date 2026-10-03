import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AssetList } from "@/components/service/asset-list";
import { listAssets, type AssetListRow } from "@/lib/service/assets/api";
import { AssetError } from "@/lib/service/assets/errors";
import { parseAssetFilters } from "@/lib/service/assets/filters";
import {
  buildTerritoryOptions,
  decideListState,
  parsePaging,
  type FilterOption,
} from "@/lib/service/assets/list-view";
import {
  loadAssetTypeOptions,
  loadCustomerOption,
  loadTerritoryRows,
  type CustomerOption,
} from "@/lib/service/assets/lookups";
import { resolveServiceAssetsAccess } from "@/lib/service/require-access";

export const metadata: Metadata = {
  title: "Assets",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toURLSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
    else if (value !== undefined) out.append(key, value);
  }
  return out;
}

/** What the screen says when the main query fails. Never the raw database message. */
function describeLoadError(err: unknown): string {
  if (err instanceof AssetError) {
    if (err.kind === "network") return err.message;
    if (err.kind === "permission") return "You don't have permission to view assets.";
    if (err.kind === "validation") {
      return "One of the filters in the address is not valid. Clear the filters and try again.";
    }
  }
  return "Something went wrong while loading assets. Please try again.";
}

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  // Re-checked here (the layout already did): layouts do not re-render on client navigation.
  const access = await resolveServiceAssetsAccess();
  if (!access.ok) redirect(access.redirectTo);
  const { supabase, accountId } = access.ctx;

  const params = toURLSearchParams(await searchParams);
  const filters = parseAssetFilters(params);
  const paging = parsePaging(params);
  const today = new Date();

  // The list and its filter lookups load in parallel. A failed LOOKUP degrades to a banner; a
  // failed LIST becomes the error state. They are settled separately so one cannot mask the other.
  const [listRes, typesRes, territoriesRes, customerRes] = await Promise.allSettled([
    listAssets(supabase, filters, { accountId, limit: paging.pageSize, offset: paging.offset, today }),
    loadAssetTypeOptions(supabase, accountId),
    loadTerritoryRows(supabase, accountId),
    filters.contactId ? loadCustomerOption(supabase, filters.contactId) : Promise.resolve(null),
  ]);

  let rows: AssetListRow[] = [];
  let total = 0;
  let loadError: { message: string } | null = null;
  if (listRes.status === "fulfilled") {
    rows = listRes.value.rows;
    total = listRes.value.total;
  } else {
    // 'validation' is a hand-edited URL, not a fault worth paging someone over.
    if (!(listRes.reason instanceof AssetError && listRes.reason.kind === "validation")) {
      console.error("[service/assets] list failed:", listRes.reason);
    }
    loadError = { message: describeLoadError(listRes.reason) };
  }

  const state = decideListState({
    failed: loadError !== null,
    rowCount: rows.length,
    offset: paging.offset,
    filters,
  });

  // Empty rows past page 1 (a stale bookmark, or the last row on the last page just archived):
  // go back to page 1 with the same filters. Not an empty state, and not dependent on `total`.
  // redirect() throws, so it stays outside any try/catch.
  if (state === "reset-page") {
    const back = new URLSearchParams(params);
    back.delete("page");
    const qs = back.toString();
    redirect(qs ? `/service/assets?${qs}` : "/service/assets");
  }

  const lookupFailures: string[] = [];

  let assetTypes: FilterOption[] = [];
  if (typesRes.status === "fulfilled") assetTypes = typesRes.value;
  else lookupFailures.push("asset types");

  let territories: FilterOption[] = [];
  if (territoriesRes.status === "fulfilled") {
    territories = buildTerritoryOptions(territoriesRes.value, filters.territoryId);
  } else {
    lookupFailures.push("territories");
  }

  // A null result with no error just means the customer is hidden from this viewer: the filter
  // still applies and the picker falls back to a generic label.
  let selectedCustomer: CustomerOption | null = null;
  if (filters.contactId) {
    if (customerRes.status === "fulfilled") selectedCustomer = customerRes.value;
    else lookupFailures.push("the selected customer");
  }

  return (
    <AssetList
      // 'reset-page' has already redirected above, so TypeScript has narrowed it away here.
      state={state}
      rows={rows}
      total={total}
      page={paging.page}
      pageSize={paging.pageSize}
      todayIso={today.toISOString()}
      filters={filters}
      loadError={loadError}
      // When the list itself failed the error state is the whole story; a banner on top is noise.
      lookupFailures={loadError ? [] : lookupFailures}
      assetTypes={assetTypes}
      territories={territories}
      selectedCustomer={selectedCustomer}
    />
  );
}

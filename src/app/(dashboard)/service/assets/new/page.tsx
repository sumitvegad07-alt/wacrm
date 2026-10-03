import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AssetForm } from "@/components/service/asset-form";
import { loadAssetFormLookups, loadCustomerOption, type CustomerOption } from "@/lib/service/assets/lookups";
import { resolveServiceAssetsAccess } from "@/lib/service/require-access";

export const metadata: Metadata = {
  title: "Add Asset",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewAssetPage({ searchParams }: { searchParams: SearchParams }) {
  // Re-checked here (the layout already did): layouts do not re-render on client navigation.
  const access = await resolveServiceAssetsAccess();
  if (!access.ok) redirect(access.redirectTo);
  const { supabase, accountId } = access.ctx;

  // /service/assets/new?contactId=... is how a customer's page opens this form with the customer
  // locked. An id that is not a customer this viewer can see (hand-edited, deleted, hidden by data
  // scope) is ignored: the form opens unlocked and the user picks a customer themselves.
  const sp = await searchParams;
  const contactId = typeof sp.contactId === "string" && sp.contactId ? sp.contactId : undefined;

  const [lookups, customer] = await Promise.all([
    loadAssetFormLookups(supabase, accountId),
    contactId
      ? loadCustomerOption(supabase, contactId).catch((): CustomerOption | null => null) // e.g. not a uuid
      : Promise.resolve<CustomerOption | null>(null),
  ]);

  return (
    <AssetForm
      accountId={accountId}
      lookups={lookups}
      canSaveOnServer={access.rights.create}
      lockedContactId={customer?.id}
      lockedContactLabel={customer?.label}
    />
  );
}

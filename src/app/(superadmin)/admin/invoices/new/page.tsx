import { notFound } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { invoiceFromProposal, type InvoicePrefill } from "@/lib/invoices/from-proposal";
import type { ProposalData } from "@/lib/proposals/types";
import InvoiceForm from "../invoice-form";

export const dynamic = "force-dynamic";

/**
 * A quotation carried onto a blank invoice.
 *
 * Read here rather than through the API so the form arrives filled in on the
 * first paint — there is no second round trip for the founder to watch. A
 * quotation that cannot be read returns undefined and the form simply opens
 * blank: a missing id is not a reason to refuse to raise an invoice.
 *
 * Nothing is written. The invoice exists only once Save is pressed, which is
 * also when its number is assigned.
 */
async function loadPrefill(id: string | undefined): Promise<InvoicePrefill | undefined> {
  if (!id) return undefined;

  const { data } = await serviceClient()
    .from("platform_proposals")
    .select("plan, ref, data")
    .eq("id", id)
    .maybeSingle();

  if (!data) return undefined;

  const row = data as { plan: string; ref: string; data: ProposalData };
  return invoiceFromProposal(row);
}

export default async function NewInvoicePage(props: {
  searchParams: Promise<{ from?: string }>;
}) {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  const { from } = await props.searchParams;
  const prefill = await loadPrefill(from);

  return <InvoiceForm mode="create" prefill={prefill} />;
}

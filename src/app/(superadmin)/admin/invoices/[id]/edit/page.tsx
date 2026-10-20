import { notFound, redirect } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { isEditable } from "@/lib/invoices/status";
import type { InvoiceRow } from "@/lib/invoices/types";
import InvoiceForm from "../../invoice-form";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage(props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  const { id } = await props.params;

  const { data } = await serviceClient()
    .from("platform_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const invoice = data as InvoiceRow;

  // An issued invoice is frozen. Sending the founder to the form and then
  // refusing his save would waste the typing, so the redirect happens here.
  if (!isEditable(invoice.status)) redirect(`/admin/invoices/${id}`);

  return <InvoiceForm mode="edit" invoice={invoice} />;
}

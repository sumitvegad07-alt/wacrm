import { notFound } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import type { InvoiceRow } from "@/lib/invoices/types";
import InvoiceDetail from "./invoice-detail";

export const dynamic = "force-dynamic";

export default async function InvoicePage(props: { params: Promise<{ id: string }> }) {
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

  return <InvoiceDetail invoice={data as InvoiceRow} />;
}

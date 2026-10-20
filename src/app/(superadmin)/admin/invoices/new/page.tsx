import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import InvoiceForm from "../invoice-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <InvoiceForm mode="create" />;
}

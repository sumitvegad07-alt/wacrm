// ============================================================
// The printable invoice. FOUNDER-ONLY.
//
// Unlike /print/order and /print/quotation, which are tenant documents behind
// RLS, this one carries OZZO's own billing and is gated on the session the same
// way /print/proposal is: requireFounder(), and notFound() for anyone else.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { InvoiceDocument } from "@/lib/invoices/template/invoice-document";
import type { InvoiceRow } from "@/lib/invoices/types";
import { DownloadButton } from "./download-button";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

/** Reads the row, or returns null for anyone who is not the platform owner. */
async function loadInvoice(id: string): Promise<InvoiceRow | null> {
  try {
    await requireFounder();
  } catch {
    return null;
  }

  const { data } = await serviceClient()
    .from("platform_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data as InvoiceRow | null) ?? null;
}

export default async function PrintInvoicePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const invoice = await loadInvoice(id);
  if (!invoice) notFound();

  return (
    <>
      <DownloadButton />
      <InvoiceDocument invoice={invoice} />
    </>
  );
}

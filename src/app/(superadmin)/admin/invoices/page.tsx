import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import InvoicesClient from "./invoices-client";

// OZZO's own invoices — founder-only, same triple gate as the proposals list:
// the (superadmin) layout blocks non-superadmins, requireFounder() 404s any
// other superadmin, and platform_invoices has RLS with no policies.
export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <InvoicesClient />;
}

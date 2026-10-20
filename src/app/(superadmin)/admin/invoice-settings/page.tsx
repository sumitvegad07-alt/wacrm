import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import SettingsForm from "./settings-form";

// OZZO's own seller details — founder-only.
//
// Triple-gated, like the proposals screens: the (superadmin) layout blocks
// non-superadmins, requireFounder() 404s any other superadmin, and
// platform_invoice_settings has RLS with no policies.
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <SettingsForm />;
}

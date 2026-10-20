import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import RenewalsClient from "./renewals-client";

// The founder's renewal register — founder-only.
//
// Triple-gated like the proposals list: the (superadmin) layout blocks
// non-superadmins, requireFounder() 404s any other superadmin, and
// platform_subscriptions has RLS with no policies.
export const dynamic = "force-dynamic";

export default async function RenewalsPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <RenewalsClient />;
}

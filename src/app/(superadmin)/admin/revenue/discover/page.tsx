import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import DiscoverClient from "./discover-client";

// Lead Discovery — founder-only prospecting for OZZO's own sales. Not a tenant
// feature: no plan gating, no rights registry, no mobile. The API route guards
// itself the same way, so this 404 is defence in depth rather than the only lock.
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }
  return <DiscoverClient />;
}

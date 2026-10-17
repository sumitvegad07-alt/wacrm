import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import OutreachClient from "./outreach-client";

// Founder-only, like Lead Discovery next door: no plan gating, no rights
// registry, no mobile. The API route guards itself the same way, so this 404
// is defence in depth rather than the only lock.
export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }
  return <OutreachClient />;
}

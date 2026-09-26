import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import ProposalsClient from "./proposals-client";

// OZZO's own sales proposals — founder-only.
//
// Triple-gated: the (superadmin) layout blocks non-superadmins, requireFounder()
// below 404s any other superadmin, and platform_proposals has RLS with no
// policies so the data is only reachable through /api/admin/proposals.
export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <ProposalsClient />;
}

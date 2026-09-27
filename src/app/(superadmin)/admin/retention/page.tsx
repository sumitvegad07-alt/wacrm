import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import RetentionClient from "./retention-client";

// Data retention — founder-only. Previews what the nightly job would remove,
// and runs it for real only on an explicit, confirmed click.
export const dynamic = "force-dynamic";

export default async function RetentionPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }
  return <RetentionClient />;
}

import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import AccessControlClient from "./access-control-client";

// Hidden, founder-only page for granting/revoking platform superadmin.
//
// It is deliberately NOT listed in the superadmin sidebar (see admin-shell.tsx)
// so the dangerous grant/revoke controls can never be reached — or clicked —
// by accident. Reach it only by typing the URL: /admin/access-control
//
// Double-gated: the (superadmin) layout already blocks non-superadmins, and
// requireFounder() below 404s anyone who is not the platform owner.
export const dynamic = "force-dynamic";

export default async function AccessControlPage() {
  try {
    await requireFounder();
  } catch {
    // 404 rather than 403 so a non-founder superadmin never learns the page exists.
    notFound();
  }

  return <AccessControlClient />;
}

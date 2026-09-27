import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import CalculatorClient from "./calculator-client";

// The founder's live price calculator — founder-only, same gate as proposals.
//
// It writes nothing: every figure is pure arithmetic from lib/plans/pricing.ts,
// computed in the browser, so there is no request per keystroke and nothing to
// clean up if a call goes nowhere. The only write is "Create proposal", which
// goes through the existing /api/admin/proposals route.
export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <CalculatorClient />;
}

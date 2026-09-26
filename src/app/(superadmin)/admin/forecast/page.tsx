import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import ForecastClient from "./forecast-client";

// Business forecasting over OZZO's own proposals — founder-only, same gate and
// same data source as /admin/proposals.
export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  return <ForecastClient />;
}

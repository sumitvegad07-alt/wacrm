import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import ProposalForm from "./proposal-form";

export const dynamic = "force-dynamic";

export default async function ProposalEditPage(props: { params: Promise<{ id: string }> }) {
  try {
    await requireFounder();
  } catch {
    notFound();
  }

  const { id } = await props.params;
  return <ProposalForm id={id} />;
}

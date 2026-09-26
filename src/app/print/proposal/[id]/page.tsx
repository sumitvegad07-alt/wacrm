// ============================================================
// The printable proposal. Founder-only.
//
// Same shape as the other /print routes, with two differences:
//   - the founder gate, because this document contains OZZO's own pricing, and
//   - no @page override: the document's own stylesheet sets `size:A4; margin:0`,
//     which is what lets the dark cover bleed to the paper edge. Overriding the
//     margin here (as the order/quotation views do for their letterheads) would
//     put a white frame around every page.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { ProposalDocument } from "@/lib/proposals/templates/document";
import type { ProposalData } from "@/lib/proposals/types";
import { ProposalPrintFrame } from "@/lib/proposals/templates/print-frame";
import { DownloadButton } from "./download-button";

interface ProposalRow {
  id: string;
  plan: string;
  client_name: string;
  ref: string;
  data: ProposalData;
}

/** Reads the row, or returns null for anyone who is not the platform owner. */
async function loadProposal(id: string): Promise<ProposalRow | null> {
  try {
    await requireFounder();
  } catch {
    return null;
  }

  const { data } = await serviceClient()
    .from("platform_proposals")
    .select("id, plan, client_name, ref, data")
    .eq("id", id)
    .maybeSingle();

  return (data as ProposalRow) ?? null;
}

/**
 * Chrome names the saved PDF after the document title, so the title IS the
 * filename. `absolute` skips the root layout's "%s — wacrm" template, which
 * would otherwise end up in the filename the client receives.
 */
export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const proposal = await loadProposal(id);
  if (!proposal) return { title: { absolute: "Proposal" } };

  const slug = (proposal.client_name || "Client").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

  return { title: { absolute: `OZZO_Proposal_${slug}` } };
}

export default async function ProposalPrintView(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const proposal = await loadProposal(id);

  // 404 rather than "forbidden": a non-founder should not learn the route exists.
  if (!proposal) notFound();

  return (
    <ProposalPrintFrame>
      <DownloadButton />
      <ProposalDocument plan={proposal.plan} data={proposal.data} />
    </ProposalPrintFrame>
  );
}

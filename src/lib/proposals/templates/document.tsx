// ============================================================
// Plan line → the pages that get printed.
//
// Kept apart from registry.ts on purpose: the registry (field schema, defaults)
// is imported by API route handlers, and this module imports a stylesheet, which
// belongs only in the React tree.
// ============================================================

import type { ProposalData } from "../types";
import { SfaProposalDocument } from "./sfa/sfa-proposal";

export function ProposalDocument({ plan, data }: { plan: string; data: ProposalData }) {
  switch (plan) {
    case "SFA":
      return <SfaProposalDocument data={data} />;
    default:
      return (
        <div style={{ padding: "40px", fontFamily: "system-ui", color: "#b91c1c" }}>
          No proposal template exists for plan “{plan}”.
        </div>
      );
  }
}

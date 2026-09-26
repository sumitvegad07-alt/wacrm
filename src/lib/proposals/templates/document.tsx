// ============================================================
// Plan line → the pages that get printed.
//
// Kept apart from registry.ts on purpose: the registry is imported by API
// route handlers, and this module imports a stylesheet, which belongs only in
// the React tree.
// ============================================================

import type { ProposalData } from "../types";
import { getTemplate } from "../registry";
import { ProposalPages } from "./proposal-pages";

export function ProposalDocument({ plan, data }: { plan: string; data: ProposalData }) {
  const template = getTemplate(plan);

  if (!template) {
    return (
      <div style={{ padding: "40px", fontFamily: "system-ui", color: "#b91c1c" }}>
        No proposal template exists for plan “{plan}”.
      </div>
    );
  }

  return <ProposalPages data={data} content={template.content} />;
}

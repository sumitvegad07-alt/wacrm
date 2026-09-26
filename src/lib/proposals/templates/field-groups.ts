// ============================================================
// The form's field schema — the same for every plan.
//
// What the founder types (who the client is, the industry wording, who signed
// it) does not change between a CRM and an SFA proposal. What DOES change per
// plan is the document's copy, which lives in templates/content/<plan>.ts.
// ============================================================

import type { ProposalFieldGroup } from "../types";

export const PROPOSAL_GROUPS: ProposalFieldGroup[] = [
  {
    title: "Identity",
    fields: [
      {
        path: "ref",
        label: "Reference no.",
        kind: "text",
        hint: "Generated when you create the proposal — edit if you use your own numbering.",
      },
      { path: "proposalDate", label: "Proposal date", kind: "date" },
      {
        path: "validDays",
        label: "Valid for (days)",
        kind: "number",
        hint: "Printed on the cover and in the first terms clause.",
      },
    ],
  },
  {
    title: "Client",
    fields: [
      { path: "client.name", label: "Company name", kind: "text", hint: "Cover and all seven page footers." },
      {
        path: "client.shortName",
        label: "Short name",
        kind: "text",
        hint: 'Used where the full name reads long: "Why ___ chooses OZZO".',
      },
      {
        path: "client.industry",
        label: "Industry label",
        kind: "text",
        hint: 'Printed on the cover, e.g. "Spices, Masala & Food Products".',
      },
      { path: "client.website", label: "Website", kind: "text" },
      { path: "client.address", label: "Address", kind: "textarea" },
    ],
  },
  {
    title: "Prepared by",
    fields: [
      { path: "preparedBy.name", label: "Signatory", kind: "text" },
      { path: "preparedBy.phone", label: "Phone", kind: "text" },
      { path: "preparedBy.email", label: "Email", kind: "text" },
    ],
  },
  {
    title: "Industry wording",
    fields: [
      {
        path: "voice.built",
        label: "What they have built",
        kind: "textarea",
        hint: "Opening line on page 2. Say what this company actually sells.",
      },
      {
        path: "voice.industryPlural",
        label: "Industry, plural",
        kind: "text",
        hint: 'Drops into "Most ___ buy a second accounting package only to answer two questions."',
      },
      {
        path: "voice.builtFor",
        label: "Built-for line",
        kind: "textarea",
        hint: 'First tile under "Why ___ chooses OZZO". Text before the — is bolded.',
      },
    ],
  },
];

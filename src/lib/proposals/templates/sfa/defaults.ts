// ============================================================
// SFA proposal template: the field list the form builds itself from, and the
// starting values.
//
// The industry wording ships with the Shaahi Niti Masale phrasing deliberately
// visible rather than blank: it shows what belongs in the field, and it is the
// exact text that must change when the next proposal goes to a plastics or
// agro company. Everything OZZO says about itself — features, terms, theme —
// is not a field, so every proposal stays on-brand.
// ============================================================

import type { ProposalData, ProposalFieldGroup } from "../../types";

export const SFA_GROUPS: ProposalFieldGroup[] = [
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

export function sfaDefaults(proposalDate: string): ProposalData {
  return {
    ref: "",
    proposalDate,
    validDays: 10,
    client: { name: "", shortName: "", industry: "", website: "", address: "" },
    preparedBy: { name: "Sumit", phone: "+91 92271 26301", email: "sales@ozzo.co.in" },
    voice: {
      built:
        "You've built a trusted spices & masala brand across a growing dealer and retailer network. As it grows, the simple questions get hard. OZZO answers each one, live.",
      industryPlural: "spices businesses",
      builtFor: "Built for FMCG distribution — trade levels, beats & schemes out of the box.",
    },
    lineItems: [
      {
        label: "OZZO SFA — Field Salesman",
        subLabel: "Android app · full field toolkit",
        users: 5,
        rate: 3600,
      },
      {
        label: "OZZO SFA — Admin / Manager",
        subLabel: "Web dashboard · reports & approvals",
        users: 1,
        rate: 3600,
      },
    ],
    gstEnabled: false,
    gstRate: 18,
  };
}

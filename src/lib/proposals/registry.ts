// ============================================================
// Plan line → proposal template.
//
// The five sellable plans come from lib/plans/catalog.ts, which is the app's
// canonical entitlement map. Taking the list price and the label from there
// means a proposal cannot quote a plan the product does not sell, and the
// form always opens at list price so any discount is a deliberate edit.
// ============================================================

import { PLAN_IDS, PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { termRatePerMonth, type BillingTerm } from "@/lib/plans/pricing";
import type { ProposalData, ProposalFieldGroup } from "./types";
import type { PlanContent } from "./templates/content-types";
import { PROPOSAL_GROUPS } from "./templates/field-groups";
import { SFA_CONTENT } from "./templates/content/sfa";
import { CRM_CONTENT } from "./templates/content/crm";
import { WFA_CONTENT } from "./templates/content/wfa";
import { CRM_WFA_CONTENT } from "./templates/content/crm-wfa";
import { CRM_SFA_CONTENT } from "./templates/content/crm-sfa";

export interface ProposalTemplate {
  plan: PlanId;
  /** "CRM + SFA" — the same label the superadmin panel and invoices use. */
  label: string;
  /**
   * List price per user per MONTH on the yearly term — the base rate, which is
   * what a new proposal opens at. A shorter term re-prices via
   * `listRatePerMonth(plan, term)`.
   */
  listRatePerMonth: number;
  groups: ProposalFieldGroup[];
  content: PlanContent;
  defaults: (proposalDate: string) => ProposalData;
}

const CONTENT: Record<PlanId, PlanContent> = {
  CRM: CRM_CONTENT,
  WFA: WFA_CONTENT,
  CRM_WFA: CRM_WFA_CONTENT,
  SFA: SFA_CONTENT,
  CRM_SFA: CRM_SFA_CONTENT,
};

/**
 * List price per user per month for a plan on a given term.
 *
 * Proposals quote monthly rates because that is the only basis that survives a
 * change of term without the number changing meaning.
 */
export function listRatePerMonth(plan: PlanId, term: BillingTerm = "yearly"): number {
  return termRatePerMonth(plan, term);
}

function buildTemplate(plan: PlanId): ProposalTemplate {
  const content = CONTENT[plan];
  const rate = listRatePerMonth(plan, "yearly");

  return {
    plan,
    label: PLAN_LABEL[plan],
    listRatePerMonth: rate,
    groups: PROPOSAL_GROUPS,
    content,
    defaults: (proposalDate: string): ProposalData => ({
      ref: "",
      // A new proposal opens on the yearly term — the base price, so the founder
      // has to choose to up-price rather than choose not to.
      billingTerm: "yearly",
      proposalDate,
      validDays: 10,
      client: { name: "", shortName: "", industry: "", website: "", address: "" },
      preparedBy: { name: "Sumit", phone: "+91 92271 26301", email: "sales@ozzo.co.in" },
      voice: { ...content.defaultVoice },
      lineItems: content.seats.map((seat) => ({ ...seat, rate })),
      gstEnabled: false,
      gstRate: 18,
    }),
  };
}

const TEMPLATES: ProposalTemplate[] = PLAN_IDS.map(buildTemplate);

export function getTemplate(plan: string): ProposalTemplate | undefined {
  return TEMPLATES.find((t) => t.plan === plan);
}

export function listTemplates(): ProposalTemplate[] {
  return TEMPLATES;
}

/** Reads "client.shortName" out of the payload, so the form needs no per-field wiring. */
export function getByPath(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
    return undefined;
  }, data);
}

/** Immutable counterpart, so React state updates never mutate the loaded payload. */
export function setByPath<T>(data: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split(".");
  const node = (data ?? {}) as Record<string, unknown>;

  return {
    ...node,
    [key]: rest.length === 0 ? value : setByPath(node[key] ?? {}, rest.join("."), value),
  } as T;
}

// ============================================================
// Which harvested leads actually become recipients.
//
// WHY THIS IS A PURE FUNCTION OVER ARRAYS
//
// There is no database test harness in this repo — vitest runs
// environment: node and there is no local Supabase stack. The rule that
// matters most here ("never message someone who asked you not to, and never
// message anyone twice") therefore cannot be left in SQL, because nothing
// would be testing it. The route fetches three lists and this decides; at the
// ~1,200 rows a district selection produces, the cost of doing it in memory is
// nothing.
//
// EVERY COMPARISON GOES THROUGH normalisePhone
//
// Not normalizePhone from whatsapp/phone-utils, which only strips non-digits.
// normalisePhone in discovery-query.ts is the India-aware one that adds 91,
// drops the trunk 0 and leaves 1800/1860/1600 alone — and it is what wrote
// every re_discovery_leads.phone value. Comparing a 91-prefixed stored number
// against a bare 10-digit one finds nothing and re-messages the lot.
// ============================================================

import { normalisePhone } from "./discovery-query";

export interface DiscoveryLeadRow {
  place_id: string;
  phone: string;
  name: string;
  city: string;
  district: string;
  state: string;
  industry: string;
}

export interface EligibleRecipient extends DiscoveryLeadRow {
  /**
   * Run through normalisePhone: usually 91XXXXXXXXXX, but 1800/1860/1600
   * toll-free numbers pass through unprefixed.
   */
  phone: string;
}

export interface Funnel {
  matched: number;
  unusablePhone: number;
  duplicate: number;
  alreadySent: number;
  suppressed: number;
  toSend: number;
}

export function selectEligible(
  leads: DiscoveryLeadRow[],
  sentPhones: string[],
  suppressedValues: string[],
): { recipients: EligibleRecipient[]; funnel: Funnel } {
  const sent = new Set(sentPhones.map(normalisePhone).filter(Boolean));
  const suppressed = new Set(suppressedValues.map(normalisePhone).filter(Boolean));

  const recipients: EligibleRecipient[] = [];
  const seen = new Set<string>();
  const funnel: Funnel = {
    matched: leads.length,
    unusablePhone: 0,
    duplicate: 0,
    alreadySent: 0,
    suppressed: 0,
    toSend: 0,
  };

  for (const lead of leads) {
    const phone = normalisePhone(lead.phone ?? "");

    if (!phone) {
      funnel.unusablePhone++;
      continue;
    }
    // One company with a Google listing per branch, all on the head-office
    // switchboard. Same pattern re_discovery_seen_places handles upstream.
    if (seen.has(phone)) {
      funnel.duplicate++;
      continue;
    }
    seen.add(phone);

    // Suppression is counted first so a number that is both suppressed and
    // already-sent appears once, and the funnel sums to `matched`.
    if (suppressed.has(phone)) {
      funnel.suppressed++;
      continue;
    }
    if (sent.has(phone)) {
      funnel.alreadySent++;
      continue;
    }

    recipients.push({ ...lead, phone });
  }

  funnel.toSend = recipients.length;
  return { recipients, funnel };
}

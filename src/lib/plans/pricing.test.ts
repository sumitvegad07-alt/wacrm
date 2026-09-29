import { describe, it, expect } from "vitest";
import { PLAN_IDS, PLAN_LINES, type PlanId } from "./catalog";
import {
  BILLING_TERMS,
  MIN_TICKET,
  MIN_USERS,
  TERM_MONTHS,
  asTerm,
  compareTerms,
  entryTicket,
  quote,
  ratePerUserForTerm,
  renewalDate,
  termRatePerMonth,
} from "./pricing";

describe("term rates", () => {
  it("yearly is the base catalog price", () => {
    expect(termRatePerMonth("SFA", "yearly")).toBe(300);
    expect(termRatePerMonth("CRM", "yearly")).toBe(100);
    expect(termRatePerMonth("CRM_SFA", "yearly")).toBe(400);
  });

  it("quarterly is +40%", () => {
    expect(termRatePerMonth("CRM", "quarterly")).toBe(140);
    expect(termRatePerMonth("WFA", "quarterly")).toBe(210);
    expect(termRatePerMonth("CRM_WFA", "quarterly")).toBe(280);
    expect(termRatePerMonth("SFA", "quarterly")).toBe(420);
    expect(termRatePerMonth("CRM_SFA", "quarterly")).toBe(560);
  });

  it("half-yearly is +20%", () => {
    expect(termRatePerMonth("SFA", "half_yearly")).toBe(360);
    expect(termRatePerMonth("CRM_SFA", "half_yearly")).toBe(480);
  });

  it("price per user covers the whole term", () => {
    expect(ratePerUserForTerm("SFA", "quarterly")).toBe(1260);
    expect(ratePerUserForTerm("SFA", "half_yearly")).toBe(2160);
    expect(ratePerUserForTerm("SFA", "yearly")).toBe(3600);
  });

  it("a shorter term always costs more per month", () => {
    for (const plan of PLAN_IDS) {
      expect(termRatePerMonth(plan, "quarterly")).toBeGreaterThan(
        termRatePerMonth(plan, "half_yearly"),
      );
      expect(termRatePerMonth(plan, "half_yearly")).toBeGreaterThan(
        termRatePerMonth(plan, "yearly"),
      );
    }
  });
});

// This is the invariant the whole "from ₹5,000" campaign rests on. If a base
// rate changes and the minimum user counts are not re-derived, the five plans
// stop sharing an entry price and the headline becomes false for some of them.
//
// The uniform-ticket invariant covers the plans it was written for — every plan
// without the FSM line. FSM prices are unapproved placeholders, so FSM plans are
// only held to the minimum-ticket floor (see MIN_USERS).
const LEGACY_PLANS = PLAN_IDS.filter((p) => !PLAN_LINES[p].fsm);
const FSM_PLANS = PLAN_IDS.filter((p) => PLAN_LINES[p].fsm);

describe("the ₹5,000 headline", () => {
  it("every non-FSM plan has the same quarterly entry ticket", () => {
    const tickets = LEGACY_PLANS.map((p) => entryTicket(p, "quarterly"));
    expect(tickets.length).toBe(5);
    expect(new Set(tickets).size).toBe(1);
    expect(tickets[0]).toBe(5040);
  });

  it("every FSM plan's quarterly entry ticket clears the advertised minimum", () => {
    expect(FSM_PLANS.length).toBe(3);
    for (const plan of FSM_PLANS) {
      expect(entryTicket(plan, "quarterly")).toBeGreaterThanOrEqual(MIN_TICKET);
    }
  });

  it("that ticket is at or above the advertised minimum", () => {
    for (const plan of PLAN_IDS) {
      expect(entryTicket(plan, "quarterly")).toBeGreaterThanOrEqual(MIN_TICKET);
    }
  });

  it("the longer terms share an entry ticket too", () => {
    expect(new Set(LEGACY_PLANS.map((p) => entryTicket(p, "half_yearly"))).size).toBe(1);
    expect(new Set(LEGACY_PLANS.map((p) => entryTicket(p, "yearly"))).size).toBe(1);
    expect(entryTicket("SFA", "half_yearly")).toBe(8640);
    expect(entryTicket("SFA", "yearly")).toBe(14400);
  });
});

// The founder's own worked example from the pricing session. Every figure here
// was checked by hand before the feature was built; they are the reason this
// test file exists.
describe("the founder's 23-user example", () => {
  const q = quote({ plan: "SFA", users: 23, term: "quarterly", discountPct: 10, gstRate: 18 });

  it("prices the quarter", () => {
    expect(q.ratePerMonth).toBe(420);
    expect(q.ratePerUser).toBe(1260);
    expect(q.subtotal).toBe(28980);
  });

  it("applies the discount and GST", () => {
    expect(q.discountAmount).toBe(2898);
    expect(q.net).toBe(26082);
    expect(q.gstAmount).toBe(4695);
    expect(q.total).toBe(30777);
  });

  it("reports what it works out to", () => {
    expect(q.effectiveRatePerMonth).toBe(378);
    expect(q.perUserPerDay).toBe(12.6);
    expect(q.annualised).toBe(104328);
  });

  it("clears both advisories", () => {
    expect(q.belowRecommended).toBe(false);
    expect(q.belowMinTicket).toBe(false);
  });

  it("shows the yearly saving the founder quotes on calls", () => {
    const rows = compareTerms({ plan: "SFA", users: 23, discountPct: 10, gstRate: 18 });
    const yearly = rows.find((r) => r.term === "yearly")!;
    const half = rows.find((r) => r.term === "half_yearly")!;

    expect(yearly.annualised).toBe(74520);
    expect(yearly.savingVsQuarterly).toBe(29808);
    expect(half.annualised).toBe(89424);
    expect(half.savingVsQuarterly).toBe(14904);
  });
});

// Founder's ruling: the minimum is a recommendation, never a block. In sales you
// cannot know in advance what has to be offered to win an account.
describe("recommended minimum users", () => {
  it("charges what was asked for, below the recommendation", () => {
    const q = quote({ plan: "CRM_SFA", users: 2, term: "quarterly", gstRate: 18 });
    expect(q.usersRequested).toBe(2);
    expect(q.usersBilled).toBe(2);
    expect(q.net).toBe(3360);
  });

  it("flags it, and says how far short it is", () => {
    const q = quote({ plan: "SFA", users: 2, term: "quarterly" });
    expect(q.belowRecommended).toBe(true);
    expect(q.minUsers).toBe(4);
    expect(q.usersToRecommended).toBe(2);
  });

  it("stays quiet at or above the recommendation", () => {
    const q = quote({ plan: "SFA", users: 4, term: "quarterly" });
    expect(q.usersBilled).toBe(4);
    expect(q.belowRecommended).toBe(false);
    expect(q.usersToRecommended).toBe(0);
  });

  it("never clamps, on any plan or term", () => {
    for (const plan of PLAN_IDS) {
      for (const term of BILLING_TERMS) {
        const q = quote({ plan, users: 1, term });
        expect(q.usersBilled).toBe(1);
        expect(q.belowRecommended).toBe(MIN_USERS[plan] > 1);
      }
    }
  });

  it("a one-user deal on the top plan still prices out", () => {
    const q = quote({ plan: "CRM_SFA", users: 1, term: "quarterly", gstRate: 18 });
    expect(q.net).toBe(1680);
    expect(q.total).toBe(1982);
    expect(q.belowRecommended).toBe(true);
  });

  it("zero users is zero, not the recommendation", () => {
    const q = quote({ plan: "SFA", users: 0, term: "quarterly" });
    expect(q.usersBilled).toBe(0);
    expect(q.net).toBe(0);
    expect(q.belowRecommended).toBe(false);
  });
});

describe("minimum ticket guard", () => {
  it("warns when a discount drops the net below ₹5,000", () => {
    const q = quote({ plan: "SFA", users: 4, term: "quarterly", discountPct: 20 });
    expect(q.net).toBe(4032);
    expect(q.belowMinTicket).toBe(true);
  });

  it("stays quiet on a healthy deal", () => {
    expect(quote({ plan: "SFA", users: 4, term: "quarterly" }).belowMinTicket).toBe(false);
  });

  it("does not block the quote — it is a warning, not a floor", () => {
    const q = quote({ plan: "SFA", users: 4, term: "quarterly", discountPct: 20 });
    expect(q.total).toBe(4032 + Math.round(4032 * 0.18));
  });
});

describe("discount and GST edges", () => {
  it("no discount means no discount line", () => {
    const q = quote({ plan: "SFA", users: 10, term: "quarterly" });
    expect(q.discountAmount).toBe(0);
    expect(q.net).toBe(q.subtotal);
  });

  it("a 100% discount is free, not negative", () => {
    const q = quote({ plan: "SFA", users: 10, term: "quarterly", discountPct: 100 });
    expect(q.net).toBe(0);
    expect(q.gstAmount).toBe(0);
    expect(q.total).toBe(0);
    expect(q.effectiveRatePerMonth).toBe(0);
  });

  it("clamps a nonsense discount rather than inverting the price", () => {
    expect(quote({ plan: "SFA", users: 10, term: "quarterly", discountPct: -50 }).net).toBe(12600);
    expect(quote({ plan: "SFA", users: 10, term: "quarterly", discountPct: 500 }).net).toBe(0);
  });

  it("zero GST is respected for a customer who is not charged it", () => {
    const q = quote({ plan: "SFA", users: 10, term: "quarterly", gstRate: 0 });
    expect(q.gstAmount).toBe(0);
    expect(q.total).toBe(q.net);
  });

  it("survives blank and NaN input without producing NaN", () => {
    const q = quote({
      plan: "SFA",
      users: Number.NaN,
      term: "quarterly",
      discountPct: Number.NaN,
      gstRate: Number.NaN,
    });
    expect(Number.isFinite(q.total)).toBe(true);
    expect(q.usersBilled).toBe(0);
    expect(q.gstRate).toBe(18);
  });

  it("printed figures always add up to the printed total", () => {
    for (const plan of PLAN_IDS) {
      for (const term of BILLING_TERMS) {
        for (const discountPct of [0, 7, 10, 33.5]) {
          const q = quote({ plan, users: 17, term, discountPct, gstRate: 18 });
          expect(q.subtotal - q.discountAmount).toBe(q.net);
          expect(q.net + q.gstAmount).toBe(q.total);
        }
      }
    }
  });
});

describe("term coercion", () => {
  it("reads a stored term", () => {
    expect(asTerm("quarterly")).toBe("quarterly");
    expect(asTerm("half_yearly")).toBe("half_yearly");
  });

  it("falls back to yearly — the base rate, so a bad value can only under-charge", () => {
    expect(asTerm(undefined)).toBe("yearly");
    expect(asTerm("monthly")).toBe("yearly");
    expect(asTerm(null)).toBe("yearly");
    expect(quote({ plan: "SFA", users: 10, term: "nonsense" as never }).ratePerMonth).toBe(300);
  });
});

describe("renewal date", () => {
  it("moves on by the term, not always a year", () => {
    const start = new Date("2026-09-27T00:00:00Z");
    expect(renewalDate(start, "quarterly").getMonth()).toBe(11); // December
    expect(renewalDate(start, "half_yearly").getFullYear()).toBe(2027);
    expect(renewalDate(start, "yearly").getFullYear()).toBe(2027);
  });

  it("matches the months the term declares", () => {
    for (const term of BILLING_TERMS) {
      const start = new Date(2026, 0, 15);
      const due = renewalDate(start, term);
      const delta =
        (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth());
      expect(delta).toBe(TERM_MONTHS[term]);
    }
  });
});

describe("compareTerms", () => {
  it("returns quarterly first, with no saving against itself", () => {
    const rows = compareTerms({ plan: "CRM", users: 20 });
    expect(rows[0].term).toBe("quarterly");
    expect(rows[0].savingVsQuarterly).toBe(0);
  });

  it("every longer term saves money on every plan", () => {
    for (const plan of PLAN_IDS as readonly PlanId[]) {
      const rows = compareTerms({ plan, users: 25, discountPct: 10 });
      for (const row of rows) {
        if (row.term === "quarterly") continue;
        expect(row.savingVsQuarterly).toBeGreaterThan(0);
      }
    }
  });
});

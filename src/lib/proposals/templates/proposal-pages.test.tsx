import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPages } from "./proposal-pages";
import { SFA_CONTENT } from "./content/sfa";
import { getTemplate } from "../registry";
import { includedGroupsForPlan } from "../plan-features";
import { compareProposalTerms } from "../term-compare";
import type { ProposalData } from "../types";
import { PLAN_LINES, type PlanId, type ProductLine } from "@/lib/plans/catalog";

// ---------------------------------------------------------------------------
// The document is a sales artefact: a dropped space or a stale figure is not a
// cosmetic bug, it is what the client reads. These tests render the real pages
// and assert the sentences and the arithmetic.
//
// They exist because porting the HTML to JSX silently ate the space in
// "Self-calculates from orders" — JSX trims whitespace at a line boundary, so
// `<b>x</b>` followed by a wrapped line loses the gap. Nothing in a type check
// or a totals test can see that.
// ---------------------------------------------------------------------------

const SHAAHI: ProposalData = {
  ...getTemplate("SFA")!.defaults("2026-09-22"),
  ref: "OZZO/2026/09/SNM-01",
  lineItems: [
    { label: "OZZO SFA — Field Salesman", subLabel: "Android app", users: 5, rate: 300 },
    { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard", users: 1, rate: 300 },
  ],
  client: {
    name: "Shaahi Niti Masale",
    shortName: "Shaahi Niti",
    industry: "Spices, Masala & Food Products",
    website: "shaahiniti.com",
    address: "Awasari Khurd, Tal. Ambegaon, Dist. Pune",
  },
};

function render(data: ProposalData) {
  return renderToStaticMarkup(
    <ProposalPages
      data={data}
      plan="SFA"
      content={SFA_CONTENT}
      groups={includedGroupsForPlan("SFA")}
    />,
  );
}

/** The document's visible words, whitespace collapsed the way a browser does. */
function renderText(data: ProposalData): string {
  return render(data)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

describe("SFA proposal document", () => {
  const text = renderText(SHAAHI);

  test("is two pages, not eight", () => {
    expect(render(SHAAHI).match(/class="page/g)).toHaveLength(2);
  });

  test("both pages carry the client's name in the footer", () => {
    expect(render(SHAAHI).match(/Shaahi Niti Masale · 0\d/g)).toEqual([
      "Shaahi Niti Masale · 01",
      "Shaahi Niti Masale · 02",
    ]);
  });

  describe("page 1 — what you get", () => {
    test("heads the sheet with the company, the reference and the date", () => {
      expect(text).toContain("Proposal for Shaahi Niti Masale");
      expect(text).toContain("OZZO/2026/09/SNM-01 · 22 September 2026 · valid 10 days");
    });

    test("names the plan and its promise", () => {
      expect(text).toContain("Everything in OZZO SFA — Complete.");
      expect(text).toContain(SFA_CONTENT.tagline);
    });

    test("lists every feature the plan is sold, and counts them honestly", () => {
      const groups = includedGroupsForPlan("SFA");
      const features = groups.flatMap((g) => g.li);

      for (const feature of features) {
        expect(text, `missing feature: ${feature}`).toContain(feature);
      }
      expect(text).toContain(`All ${features.length} features above are included`);
    });

    test("carries the benefit lines", () => {
      expect(text).toContain("Built for FMCG distribution — trade levels, beats & schemes out of the box.");
      expect(text).toContain("No second software — outstanding & stock included, not extra.");
      expect(text).toContain("Works offline — orders never wait for a signal.");
      expect(text).toContain("Made in India, priced for India — ₹300/user/month, all in.");
      expect(text).toContain("Live in days — we set up your products & team for you.");
      expect(text).toContain("Real support — over WhatsApp & email, from real people.");
    });

    test("uses the short name where the full name reads long", () => {
      expect(text).toContain("Why Shaahi Niti chooses OZZO");
    });

    test("falls back to the full name when no short name is given", () => {
      const t = renderText({ ...SHAAHI, client: { ...SHAAHI.client, shortName: "" } });
      expect(t).toContain("Why Shaahi Niti Masale chooses OZZO");
    });

    test("the built-for line bolds the part before the dash", () => {
      const html = render({
        ...SHAAHI,
        voice: { ...SHAAHI.voice, builtFor: "Built for pharma — cold chain included." },
      });
      expect(html).toContain("<b>Built for pharma</b> — cold chain included.");
    });
  });

  describe("page 2 — the money", () => {
    test("prices each row per month and per term", () => {
      // 5 seats + 1 admin at ₹300/user/month on a 12-month term.
      expect(text).toContain("Rate / user / month");
      expect(text).toContain("Per user for the year");
      expect(text).toContain("3,600"); // 300 × 12
      expect(text).toContain("18,000"); // 5 × 300 × 12
    });

    test("the ladder totals what the rows add up to", () => {
      expect(text).toContain("Subtotal₹21,600");
      expect(text).toContain("Total payable₹21,600");
    });

    test("shows no discount line when the proposal quotes list price", () => {
      expect(text).not.toContain("off list");
      expect(text).not.toContain("At list price");
    });

    test("the four headline tiles read off the same figures", () => {
      expect(text).toContain("Effective rate₹300per user / month");
      // 21,600 over 6 users × 12 months × 30 days.
      expect(text).toContain("Per user / day₹10.0every working day");
      expect(text).toContain("Total for one year₹21,600paying this often");
      expect(text).toContain("in 12 months");
    });

    test("renews one term after the proposal date", () => {
      expect(text).toMatch(/Next payment due\d+ \w+ 2027in 12 months/);
    });

    test("carries the terms and conditions", () => {
      expect(text).toContain("Valid for 10 days from the date of issue (22 September 2026).");
      expect(text).toContain(
        "100% advance — the year’s subscription is payable in full before onboarding begins.",
      );
      expect(text).toContain(
        "The field app is on Android; the admin dashboard runs in any web browser. No iOS (iPhone) app at this time.",
      );
      expect(text).toContain(
        "Includes software, server, maintenance, implementation, and training & support — nothing on this list is billed separately.",
      );
      expect(text).toContain(
        "Anything beyond this quotation carries extra charges. Please obtain a separate quote for customization before placing your order.",
      );
    });
  });

  describe("the billing-period table", () => {
    test("shows only the quoted period by default", () => {
      expect(text).toContain("Your billing termHow often you pay");
      expect(text).toContain("Yearly · 12 months₹300₹21,600₹21,600");
      expect(text).not.toContain("on a longer term");
      expect(text).not.toContain("Quarterly");
      expect(text).not.toContain("Half-Yearly");
      expect(text).not.toContain("You save");
    });

    test("shows all three periods with their savings when asked", () => {
      const t = renderText({ ...SHAAHI, showAllTerms: true });

      expect(t).toContain("The same 6 users on a longer term");
      expect(t).toContain("Quarterly");
      expect(t).toContain("Half-Yearly");
      expect(t).toContain("Yearly (quoted)");
      expect(t).toContain("You save");
    });

    test("every figure in it is what compareProposalTerms computed", () => {
      const t = renderText({ ...SHAAHI, showAllTerms: true });
      const rows = compareProposalTerms({
        plan: "SFA",
        lineItems: SHAAHI.lineItems,
        quotedTerm: "yearly",
      });

      for (const row of rows) {
        expect(t, `${row.term} per-invoice`).toContain(row.subtotal.toLocaleString("en-IN"));
        expect(t, `${row.term} annualised`).toContain(row.annualised.toLocaleString("en-IN"));
      }
    });

    test("the quoted row is the price the table above it charges", () => {
      const t = renderText({ ...SHAAHI, showAllTerms: true });
      // Both the price table's subtotal and the comparison's yearly invoice.
      expect(t).toContain("Subtotal₹21,600");
      expect(t).toContain("Yearly (quoted) · 12 months₹300₹21,600₹21,600₹8,640");
    });

    test("a quarterly proposal marks quarterly as the quoted row", () => {
      const quarterly = renderText({
        ...SHAAHI,
        billingTerm: "quarterly",
        showAllTerms: true,
        // Re-priced at the quarterly list rate, as changeTerm would.
        lineItems: SHAAHI.lineItems.map((li) => ({ ...li, rate: 420 })),
      });
      expect(quarterly).toContain("Quarterly (quoted)");
      expect(quarterly).not.toContain("Yearly (quoted)");
      expect(quarterly).toContain("billed quarterly");
    });
  });

  describe("a negotiated discount", () => {
    const discounted = renderText({
      ...SHAAHI,
      lineItems: SHAAHI.lineItems.map((li) => ({ ...li, rate: 270 })),
    });

    test("shows list price, the discount and the net", () => {
      expect(discounted).toContain("At list price₹21,600");
      expect(discounted).toContain("Discount (10% off list)− ₹2,160");
      expect(discounted).toContain("Net amount₹19,440");
      expect(discounted).toContain("Total payable₹19,440");
    });

    test("the tiles are the discounted rate, not the list one", () => {
      expect(discounted).toContain("Effective rate₹270per user / month");
      // 19,440 / (6 × 12 × 30)
      expect(discounted).toContain("₹9.0every working day");
    });
  });

  describe("GST off — the reference document", () => {
    test("keeps the no-GST headline", () => {
      expect(text).toContain("One price. Every module. No GST to add.");
    });

    test("shows the 18% as a saving rather than a charge", () => {
      expect(text).toContain("GST @ 18% — not chargedyou save ₹3,888");
    });

    test("states in the terms that no GST is charged", () => {
      expect(text).toContain(
        "No GST is charged. The amount payable is exactly ₹21,600 for the year, with nothing added on top.",
      );
    });
  });

  describe("GST on — every claim swaps together", () => {
    const gstText = renderText({ ...SHAAHI, gstEnabled: true });

    test("drops the no-GST headline", () => {
      expect(gstText).toContain("One price. Every module. Every user.");
      expect(gstText).not.toContain("No GST to add");
    });

    test("bills the GST in the ladder instead of offering it as a saving", () => {
      expect(gstText).toContain("GST @ 18%₹3,888");
      expect(gstText).not.toContain("not charged");
      expect(gstText).not.toContain("you save ₹3,888");
    });

    test("headlines the grand total, not the subtotal", () => {
      expect(gstText).toContain("Total payable₹25,488");
      expect(gstText).toContain("Your ₹25,488 covers everything");
    });

    test("rewrites the tax clause", () => {
      expect(gstText).toContain("GST at 18% is charged as shown above.");
      expect(gstText).toContain("Total payable ₹25,488 for the year, including ₹3,888 of GST.");
    });

    test("leaves no claim that nothing is added on top", () => {
      expect(gstText).not.toContain("nothing added on top");
      expect(gstText).not.toContain("No GST");
    });
  });

  describe("a changed rate flows everywhere", () => {
    const t = renderText({
      ...SHAAHI,
      lineItems: [
        { label: "Field", subLabel: "", users: 5, rate: 400 },
        { label: "Admin", subLabel: "", users: 1, rate: 400 },
      ],
    });

    test("no stale figure survives", () => {
      expect(t).toContain("in your ₹400 / user / month");
      expect(t).toContain("₹400/user/month, all in");
      expect(t).toContain("exactly ₹28,800 for the year");
      expect(t).not.toContain("21,600");
      expect(t).not.toContain("₹300");
    });
  });

  describe("the billing-period table names its columns in plain words", () => {
    // Renamed 5 October 2026: "Per invoice / Over 12 months / You save" read as
    // three versions of the same number. These are the words the founder reads
    // out on the phone, so a rename is a deliberate act, not a tidy-up.
    const t = renderText({ ...SHAAHI, showAllTerms: true });

    for (const header of [
      "How often you pay",
      "Price / user / month",
      "You pay each time",
      "Total for one year",
      "You save in a year",
    ]) {
      test(header, () => expect(t).toContain(header));
    }

    test("the tile and the column agree on what a year costs", () => {
      // Same words for the same figure, so nobody has to work out that
      // "over 12 months" and "total for one year" are one thing.
      expect(t).toContain("Total for one year₹21,600");
      expect(t.match(/Total for one year/g)!.length).toBe(2);
    });
  });

  describe("a half-filled proposal still renders", () => {
    const empty = renderText({
      ...getTemplate("SFA")!.defaults("2026-09-22"),
      ref: "OZZO/2026/09/OZ-01",
      lineItems: [],
    });

    test("prints zeros rather than NaN", () => {
      expect(empty).not.toContain("NaN");
      expect(empty).toContain("Your ₹0 covers everything");
      expect(empty).toContain("₹0.0every working day");
    });

    test("uses a placeholder where the company name is not filled in yet", () => {
      expect(empty).toContain("Proposal for —");
    });
  });
});

// ---------------------------------------------------------------------------
// Every plan, rendered end to end. The data-level guard in plan-features.test
// checks the category table; this checks what actually reaches the paper —
// a WFA customer reading "Leads, Deals & Quotations" has been told they are
// buying a CRM, and the database will refuse them the leads they paid for.
// ---------------------------------------------------------------------------

describe("no plan's document promises another plan's product line", () => {
  const FORBIDDEN: Record<ProductLine, RegExp> = {
    // Not the bare word "WhatsApp": every plan offers WhatsApp support, and
    // the chips say so. These are the CRM modules.
    crm: /lead|deal|kanban|pipeline|whatsapp (inbox|broadcasting|chatbot|template)|whatsapp & automation/i,
    sfa: /order collection|dispatch|stock|price list|scheme|route management|outstanding/i,
    wfa: /geo-|odometer|punch-in|location tracking|travelled route|live feed/i,
    fsm: /work order|job card|complaint ticket/i,
  };

  for (const plan of ["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"] as PlanId[]) {
    const template = getTemplate(plan)!;
    const lines = PLAN_LINES[plan];

    const html = renderToStaticMarkup(
      <ProposalPages
        data={{ ...template.defaults("2026-10-05"), showAllTerms: true }}
        plan={plan}
        content={template.content}
        groups={includedGroupsForPlan(plan)}
      />,
    );
    const words = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

    for (const line of ["crm", "wfa", "sfa", "fsm"] as ProductLine[]) {
      if (lines[line]) continue;

      test(`${plan} says nothing from the ${line.toUpperCase()} line`, () => {
        const hit = words.match(FORBIDDEN[line]);
        expect(hit?.[0] ?? null, `${plan} printed "${hit?.[0]}"`).toBeNull();
      });
    }
  }

  test("the two headings that were wrong are gone", () => {
    // WFA printed "Leads, Deals & Quotations" over a single follow-up feature;
    // CRM printed "Attendance & Field Discipline" over a leave calendar.
    const headingsFor = (plan: PlanId) =>
      includedGroupsForPlan(plan)
        .map((g) => g.h)
        .join(" | ");

    expect(headingsFor("WFA")).not.toMatch(/lead|deal|quotation/i);
    expect(headingsFor("CRM")).not.toMatch(/field|location|visit/i);
    expect(headingsFor("CRM")).toContain("Attendance & Leave");
  });
});

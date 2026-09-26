import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPages } from "./proposal-pages";
import { SFA_CONTENT } from "./content/sfa";
import { getTemplate } from "../registry";
import { includedGroupsForPlan } from "../plan-features";
import type { ProposalData } from "../types";

// ---------------------------------------------------------------------------
// The document is a sales artefact: a dropped space or a stale figure is not a
// cosmetic bug, it is what the client reads. These tests render the real pages
// and assert the sentences, exactly as the reference proposal prints them.
//
// They exist because porting the HTML to JSX silently ate the space in
// "Self-calculates from orders" — JSX trims whitespace at a line boundary, so
// `<b>x</b>` followed by a wrapped line loses the gap. Nothing in a type check
// or a totals test can see that.
// ---------------------------------------------------------------------------

const SHAAHI: ProposalData = {
  ...getTemplate("SFA")!.defaults("2026-09-22"),
  ref: "OZZO/2026/09/SNM-01",
  // The reference proposal was quoted at 3,600, below the catalog list price.
  lineItems: [
    { label: "OZZO SFA — Field Salesman", subLabel: "Android app", users: 5, rate: 3600 },
    { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard", users: 1, rate: 3600 },
  ],
  client: {
    name: "Shaahi Niti Masale",
    shortName: "Shaahi Niti",
    industry: "Spices, Masala & Food Products",
    website: "shaahiniti.com",
    address: "Awasari Khurd, Tal. Ambegaon, Dist. Pune",
  },
};

/** The document's visible words, whitespace collapsed the way a browser does. */
function renderText(data: ProposalData): string {
  const html = renderToStaticMarkup(<ProposalPages data={data} content={SFA_CONTENT} groups={includedGroupsForPlan("SFA")} />);
  return html
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

  test("renders eight pages", () => {
    const html = renderToStaticMarkup(<ProposalPages data={SHAAHI} content={SFA_CONTENT} groups={includedGroupsForPlan("SFA")} />);
    expect(html.match(/class="page/g)).toHaveLength(8);
  });

  describe("sentences that cross a bold boundary keep their spaces", () => {
    const sentences = [
      // Page 1
      "A tailored proposal for Shaahi Niti Masale.",
      // Page 2 — the five answers and the sign-off
      "Selfie + GPS attendance and live location for every rep, all day.",
      "Geo-tagged, geo-fenced visits — check-in only works at the shop.",
      "Orders captured at the counter — even offline — with a branded PDF.",
      "Self-calculates from orders & collections — plus an Ageing report.",
      "A live stock ledger derives closing stock — no godown guessing.",
      "One system, updated in real time — no paper, no re-typing, no separate accounting software. The rest of this proposal shows exactly what you get and what it costs.",
      // Page 5
      "Everything above is included in your ₹3,600 / user / year — there are no per-module charges and no hidden fees.",
      // Page 6 — the why tiles
      "Built for FMCG distribution — trade levels, beats & schemes out of the box.",
      "No second software — outstanding & stock included, not extra.",
      "Works offline — orders never wait for a signal.",
      "Made in India, priced for India — ₹300/user/month, all in.",
      "Live in days — we set up your products & team for you.",
      "Real support — over WhatsApp & email, from real people.",
      // Page 7 — terms
      "This proposal and its pricing are valid for 10 days from the date of issue (22 September 2026).",
      "100% advance — the annual subscription is payable in full before onboarding begins.",
      "The field app is available on Android, with the admin dashboard on any web browser. An iOS (iPhone) app is not available at this time.",
      "The quoted amount includes software, server, maintenance, implementation, and training & support — there are no separate charges for any of these.",
      // Page 8
      "Any additional customization will incur extra charges based on the specific requirements.",
      "We kindly request you to confirm and obtain a separate quote for any customization before placing your order.",
    ];

    for (const sentence of sentences) {
      test(sentence.slice(0, 60), () => {
        expect(text).toContain(sentence);
      });
    }
  });

  describe("client-specific values reach the pages", () => {
    test("the full name is on the cover and the page footers", () => {
      const footers = renderToStaticMarkup(<ProposalPages data={SHAAHI} content={SFA_CONTENT} groups={includedGroupsForPlan("SFA")} />).match(
        /Shaahi Niti Masale · 0\d/g,
      );
      // Pages 02-07. The cover and the thank-you page carry no footer.
      expect(footers).toHaveLength(6);
    });

    test("the short name is used where the full name reads long", () => {
      expect(text).toContain("Why Shaahi Niti chooses OZZO");
      expect(text).toContain("We'd love to put Shaahi Niti");
    });

    test("falls back to the full name when no short name is given", () => {
      const t = renderText({ ...SHAAHI, client: { ...SHAAHI.client, shortName: "" } });
      expect(t).toContain("Why Shaahi Niti Masale chooses OZZO");
    });

    test("the industry sentence is the one from the form, not a hardcoded industry", () => {
      const t = renderText({
        ...SHAAHI,
        voice: { ...SHAAHI.voice, industryPlural: "plastics manufacturers" },
      });
      expect(t).toContain("Most plastics manufacturers buy a second accounting package");
      expect(t).not.toContain("Most spices businesses");
    });

    test("the built-for line bolds the part before the dash", () => {
      const html = renderToStaticMarkup(
        <ProposalPages
          data={{ ...SHAAHI, voice: { ...SHAAHI.voice, builtFor: "Built for pharma — cold chain included." } }}
          content={SFA_CONTENT}
          groups={includedGroupsForPlan("SFA")}
        />,
      );
      expect(html).toContain("<b>Built for pharma</b> — cold chain included.");
    });
  });

  describe("every repeat of a figure agrees", () => {
    test("the annual total is the same in all four places it appears", () => {
      // price table, savings panel, "covers everything" heading, terms clause 5
      expect(text.match(/21,600/g)).toHaveLength(4);
    });

    test("the per-month rate appears on the price hero and in the why tile", () => {
      // Both spellings of the same derived figure: the price hero and the tile.
      expect(text).toContain("≈ ₹300 / user / month");
      expect(text).toContain("₹300/user/month, all in");
    });

    test("the user count drives the onboarding step, not a typed number", () => {
      expect(text).toContain("your 6 logins are created");

      const t = renderText({
        ...SHAAHI,
        lineItems: [{ label: "Field", subLabel: "", users: 25, rate: 3600 }],
      });
      expect(t).toContain("your 25 logins are created");
    });

    test("a changed rate flows to every place the price is printed", () => {
      const t = renderText({
        ...SHAAHI,
        lineItems: [
          { label: "Field", subLabel: "", users: 5, rate: 4800 },
          { label: "Admin", subLabel: "", users: 1, rate: 4800 },
        ],
      });

      expect(t).toContain("Your price of ₹4,800 per user, per year");
      expect(t).toContain("≈ ₹400 / user / month");
      expect(t).toContain("in your ₹4,800 / user / year");
      expect(t).toContain("₹400/user/month, all in");
      expect(t).toContain("exactly ₹28,800 for the year");
      expect(t).not.toContain("3,600");
    });
  });

  describe("GST off — the reference document", () => {
    test("keeps the no-GST headline", () => {
      expect(text).toContain("One price. Every module. No GST to add.");
    });

    test("shows the 18% as a saving", () => {
      expect(text).toContain(
        "No GST — you save 18%. OZZO is not charging GST on this proposal, so the amount you pay is exactly ₹21,600 for the year — nothing added on top. That's a straight ₹3,888 saving versus a GST-billed quote.",
      );
    });

    test("states in the terms that no GST is charged", () => {
      expect(text).toContain(
        "No GST is charged on this proposal. The amount payable is exactly ₹21,600 for the year, with nothing added on top.",
      );
    });
  });

  describe("GST on — every claim swaps together", () => {
    const gstText = renderText({ ...SHAAHI, gstEnabled: true });

    test("drops the no-GST headline", () => {
      expect(gstText).toContain("One price. Every module. Every user.");
      expect(gstText).not.toContain("No GST to add");
    });

    test("bills the GST instead of offering it as a saving", () => {
      expect(gstText).toContain("GST @ 18% — ₹3,888 is billed as shown above");
      expect(gstText).not.toContain("you save 18%");
      expect(gstText).not.toContain("saving versus a GST-billed quote");
    });

    test("adds subtotal and GST rows to the price table", () => {
      expect(gstText).toContain("Subtotal");
      expect(gstText).toContain("GST @ 18%");
      expect(gstText).toContain("Total payable / year (incl. GST)");
    });

    test("headlines the grand total, not the subtotal", () => {
      expect(gstText).toContain("Your ₹25,488 covers everything");
    });

    test("rewrites the tax clause", () => {
      expect(gstText).toContain("GST at 18% is charged as shown on the Investment page");
      expect(gstText).toContain("The total payable is ₹25,488 for the year, including ₹3,888 of GST.");
    });

    test("leaves no claim that nothing is added on top", () => {
      expect(gstText).not.toContain("nothing added on top");
      expect(gstText).not.toContain("No GST");
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
    });

    test("uses a placeholder where the company name is not filled in yet", () => {
      expect(empty).toContain("A tailored proposal for —.");
    });
  });
});

import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TermCards } from "./term-cards";

// ---------------------------------------------------------------------------
// The question this answers is the one the founder gets on a call: "CRM + SFA,
// five users — what is it for 3, 6 and 12 months?" The three figures have to be
// on screen together, for the plan that was picked, without changing tab.
//
// The expected rupee figures are the ones the live calculator already produces
// for CRM_SFA at five users (quarterly ₹9,912 incl GST), so a drift in the
// pricing engine fails here rather than on a call.
// ---------------------------------------------------------------------------

function html(markup: string): string {
  // Strip tags so assertions read like what a person sees, not like markup.
  return markup.replace(/<[^>]*>/g, " ").replace(/&#x20B9;|₹/g, "₹").replace(/\s+/g, " ");
}

describe("TermCards", () => {
  test("shows all three billing terms for the chosen plan", () => {
    const out = html(
      renderToStaticMarkup(
        <TermCards plan="CRM_SFA" users={5} discountPct={0} gstEnabled selectedTerm="quarterly" />,
      ),
    );

    expect(out).toContain("Quarterly");
    expect(out).toContain("Half-Yearly");
    expect(out).toContain("Yearly");
  });

  test("prices five CRM + SFA users on every term, GST included", () => {
    const out = html(
      renderToStaticMarkup(
        <TermCards plan="CRM_SFA" users={5} discountPct={0} gstEnabled selectedTerm="quarterly" />,
      ),
    );

    expect(out).toContain("9,912");  // 3 months
    expect(out).toContain("16,992"); // 6 months
    expect(out).toContain("28,320"); // 12 months
  });

  test("drops GST from every card when the customer is not charged it", () => {
    const out = html(
      renderToStaticMarkup(
        <TermCards
          plan="CRM_SFA"
          users={5}
          discountPct={0}
          gstEnabled={false}
          selectedTerm="quarterly"
        />,
      ),
    );

    expect(out).toContain("8,400");  // net, 3 months
    expect(out).toContain("24,000"); // net, 12 months
    expect(out).not.toContain("9,912");
  });

  test("states what the longer terms save against quarterly", () => {
    const out = html(
      renderToStaticMarkup(
        <TermCards plan="CRM_SFA" users={5} discountPct={0} gstEnabled selectedTerm="quarterly" />,
      ),
    );

    // Quarterly annualises to ₹33,600 net; yearly costs ₹24,000.
    expect(out).toContain("9,600");
    expect(out).toContain("4,800");
  });

  test("re-prices when the user count changes — the figure is never fixed", () => {
    const five = html(
      renderToStaticMarkup(
        <TermCards plan="CRM_SFA" users={5} discountPct={0} gstEnabled selectedTerm="quarterly" />,
      ),
    );
    const ten = html(
      renderToStaticMarkup(
        <TermCards plan="CRM_SFA" users={10} discountPct={0} gstEnabled selectedTerm="quarterly" />,
      ),
    );

    expect(five).toContain("9,912");
    expect(ten).toContain("19,824");
    expect(ten).not.toContain("9,912");
  });
});

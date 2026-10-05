import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OutstandingSettings } from "./outstanding-settings";
import {
  DEFAULT_OUTSTANDING_CONFIG,
  ORDER_STATUS_PRESETS,
} from "@/lib/payments/outstanding-config";

// ---------------------------------------------------------------------------
// The question this answers is the one the admin is actually asking: "which
// rule is my account on right now?" A panel that cannot show that honestly is
// worse than no panel, because outstanding is derived live — whatever is
// selected here is what every balance in the app is already using.
// ---------------------------------------------------------------------------

function noop() {}

/** Which rule buttons are shown as selected (aria-pressed). */
function selectedLabels(markup: string): string[] {
  const out: string[] = [];
  const buttons = markup.match(/<button[^>]*aria-pressed="true"[\s\S]*?<\/button>/g) ?? [];
  for (const b of buttons) {
    const label = b.match(/<p class="text-sm font-medium">([^<]*)<\/p>/);
    if (label) out.push(label[1]);
  }
  return out;
}

describe("OutstandingSettings", () => {
  test("an untouched account shows the Closed rule selected", () => {
    const markup = renderToStaticMarkup(
      <OutstandingSettings
        orderStatuses={DEFAULT_OUTSTANDING_CONFIG.orderStatuses}
        paymentStatuses={DEFAULT_OUTSTANDING_CONFIG.paymentStatuses}
        onChange={noop}
      />,
    );

    expect(selectedLabels(markup)).toEqual(["An order is Closed", "A payment is Approved"]);
  });

  test("a dispatch-based account shows the dispatch rule selected", () => {
    const markup = renderToStaticMarkup(
      <OutstandingSettings
        orderStatuses={[...ORDER_STATUS_PRESETS.on_dispatch]}
        paymentStatuses={["Approved"]}
        onChange={noop}
      />,
    );

    expect(selectedLabels(markup)).toContain("Goods are dispatched");
  });

  test("a preset account does not show the raw status ticks", () => {
    const markup = renderToStaticMarkup(
      <OutstandingSettings
        orderStatuses={DEFAULT_OUTSTANDING_CONFIG.orderStatuses}
        paymentStatuses={DEFAULT_OUTSTANDING_CONFIG.paymentStatuses}
        onChange={noop}
      />,
    );

    expect(markup).not.toContain("Tick every order status");
  });

  test("a hand-picked combination opens with its ticks visible", () => {
    // Otherwise the admin cannot see what the account is actually counting.
    const markup = renderToStaticMarkup(
      <OutstandingSettings
        orderStatuses={["Pending", "Closed"]}
        paymentStatuses={["Approved"]}
        onChange={noop}
      />,
    );

    expect(markup).toContain("Tick every order status");
    expect(selectedLabels(markup)).toContain("Custom");
  });

  test("warns rather than silently zeroing every balance when nothing is ticked", () => {
    const markup = renderToStaticMarkup(
      <OutstandingSettings orderStatuses={[]} paymentStatuses={["Approved"]} onChange={noop} />,
    );

    expect(markup).toContain("Pick at least one status");
  });

  test("tells the admin the change takes effect immediately", () => {
    // Outstanding is not stored, so this is not a "from today onwards" setting —
    // every existing balance restates the moment it is saved.
    const markup = renderToStaticMarkup(
      <OutstandingSettings
        orderStatuses={DEFAULT_OUTSTANDING_CONFIG.orderStatuses}
        paymentStatuses={DEFAULT_OUTSTANDING_CONFIG.paymentStatuses}
        onChange={noop}
      />,
    );

    expect(markup).toContain("straight away");
  });
});

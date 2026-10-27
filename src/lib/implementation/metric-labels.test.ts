import { describe, expect, test } from "vitest";
import { RESOLVERS } from "./resolvers";
import { METRIC_LABELS, metricLabel } from "./metric-labels";

// ---------------------------------------------------------------------------
// Getting Started is the first screen a new customer sees after signing up.
// It showed `lead_count`, `deal_count`, `quotation_count`, `product_count`,
// `price_list_count` and `order_count` -- raw database keys -- on six of its
// nine health tiles, because the labels lived in two hand-written maps
// (HealthPanel and StepPanel) and neither was tied to the resolver list. New
// metrics were added to RESOLVERS and nobody remembered the maps.
//
// This test is the thing that stops it happening a third time: a resolver
// without a label fails here, at `npm test`, rather than in front of a
// customer.
// ---------------------------------------------------------------------------

describe("METRIC_LABELS", () => {
  test("every resolver has a customer-facing label", () => {
    const unlabelled = Object.keys(RESOLVERS).filter((key) => !METRIC_LABELS[key]);
    expect(unlabelled).toEqual([]);
  });

  test("no label is a raw key leaking through", () => {
    // A label that merely repeats its key is the bug wearing a disguise.
    const lazy = Object.entries(METRIC_LABELS).filter(([key, label]) => label === key);
    expect(lazy).toEqual([]);
  });

  test("labels read as English, not as column names", () => {
    for (const [key, label] of Object.entries(METRIC_LABELS)) {
      expect(label, `${key} should not contain an underscore`).not.toMatch(/_/);
      expect(label.trim(), `${key} should not be blank`).not.toBe("");
    }
  });

  test("metricLabel falls back to the key only for something unknown", () => {
    expect(metricLabel("lead_count")).toBe("Leads");
    expect(metricLabel("product_count")).toBe("Products");
    expect(metricLabel("not_a_real_metric")).toBe("not_a_real_metric");
  });
});

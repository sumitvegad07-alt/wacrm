import { describe, expect, it } from "vitest";
import {
  buildFieldCatalog,
  fieldTypeMap,
  findField,
  isKnownField,
  MODULE_EVENTS,
  MODULE_GROUPS,
  type CustomFieldRow,
} from "./field-catalog";

const row = (over: Partial<CustomFieldRow>): CustomFieldRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  field_name: "Some Field",
  field_type: "text",
  module_name: "contact",
  source_type: "static",
  system_key: null,
  is_active: true,
  field_options: null,
  ...over,
});

describe("buildFieldCatalog — module groups", () => {
  it("exposes only customer fields for the customer module", () => {
    const { groups } = buildFieldCatalog("customer", []);
    expect(groups.map((g) => g.key)).toEqual(["customer"]);
  });

  it("exposes customer fields alongside order fields for order events", () => {
    // Required by the primary use case: "new order, but only customers in Gujarat".
    const { groups } = buildFieldCatalog("order", []);
    expect(groups.map((g) => g.key)).toEqual(["order", "customer"]);
    expect(isKnownField(groups, "customer.state")).toBe(true);
    expect(isKnownField(groups, "order.total_amount")).toBe(true);
  });

  it("exposes dispatch, order and customer fields for dispatch events", () => {
    const { groups } = buildFieldCatalog("dispatch", []);
    expect(groups.map((g) => g.key)).toEqual(["dispatch", "order", "customer"]);
    expect(isKnownField(groups, "dispatch.lr_no")).toBe(true);
    expect(isKnownField(groups, "customer.city")).toBe(true);
  });

  it("keeps MODULE_GROUPS and MODULE_EVENTS in step", () => {
    for (const moduleKey of Object.keys(MODULE_GROUPS) as Array<keyof typeof MODULE_GROUPS>) {
      expect(MODULE_EVENTS[moduleKey].length).toBeGreaterThan(0);
    }
  });
});

describe("buildFieldCatalog — the stale-registry trap", () => {
  // These system_keys are registered in production but have no matching column.
  // If they reached the dropdown, an admin would build a condition on
  // "Delivery Date", it would resolve to undefined on every order, and the
  // automation would silently never match.
  const stale: CustomFieldRow[] = [
    row({ id: "a", field_name: "Type", system_key: "type", module_name: "contact" }),
    row({ id: "b", field_name: "Status", system_key: "status", module_name: "contact" }),
    row({ id: "c", field_name: "Valid Until", system_key: "valid_until", module_name: "order" }),
    row({ id: "d", field_name: "Delivery Date", system_key: "delivery_date", module_name: "order" }),
    row({ id: "e", field_name: "Payment Terms", system_key: "payment_terms", module_name: "order" }),
  ];

  it("omits registered keys that are not real columns", () => {
    const { groups } = buildFieldCatalog("order", stale);
    expect(isKnownField(groups, "order.valid_until")).toBe(false);
    expect(isKnownField(groups, "order.delivery_date")).toBe(false);
    expect(isKnownField(groups, "order.payment_terms")).toBe(false);
    expect(isKnownField(groups, "customer.type")).toBe(false);
    expect(isKnownField(groups, "customer.status")).toBe(false);
  });

  it("reports what it omitted so the drift stays visible", () => {
    const { omittedSystemKeys } = buildFieldCatalog("order", stale);
    expect(omittedSystemKeys).toContain("order.delivery_date");
    expect(omittedSystemKeys).toContain("contact.type");
    // De-duplicated and sorted for a stable log line.
    expect(omittedSystemKeys).toEqual([...new Set(omittedSystemKeys)].sort());
  });

  it("still exposes the real columns beside the stale ones", () => {
    const { groups } = buildFieldCatalog("order", stale);
    expect(isKnownField(groups, "order.status")).toBe(true);
    expect(isKnownField(groups, "order.total_amount")).toBe(true);
  });

  it("does not report a duplicate registry entry as drift when the column is real", () => {
    // Production has two 'Order Date' entries: order_date (stale) and date (real).
    const { groups, omittedSystemKeys } = buildFieldCatalog("order", [
      row({ id: "f", field_name: "Order Date", system_key: "order_date", module_name: "order" }),
      row({ id: "g", field_name: "Order Date", system_key: "date", module_name: "order" }),
    ]);
    expect(isKnownField(groups, "order.date")).toBe(true);
    expect(omittedSystemKeys).toContain("order.order_date");
    expect(omittedSystemKeys).not.toContain("order.date");
  });
});

describe("buildFieldCatalog — labels", () => {
  it("prefers the admin's registered label over the built-in one", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({ field_name: "Firm Name", system_key: "company", module_name: "contact" }),
    ]);
    expect(findField(groups, "customer.company")?.label).toBe("Firm Name");
  });

  it("falls back to the built-in label when the field is not registered", () => {
    const { groups } = buildFieldCatalog("customer", []);
    expect(findField(groups, "customer.company")?.label).toBe("Company");
  });

  it("ignores inactive registry rows", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({ field_name: "Hidden", system_key: "company", module_name: "contact", is_active: false }),
    ]);
    expect(findField(groups, "customer.company")?.label).toBe("Company");
  });
});

describe("buildFieldCatalog — custom fields", () => {
  it("exposes admin-defined custom fields under a custom: key", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({
        id: "cf-1",
        field_name: "Customer Tier",
        field_type: "select",
        source_type: "module",
        module_name: "contact",
        field_options: ["Gold", "Silver"],
      }),
    ]);
    const field = findField(groups, "customer.custom:cf-1");
    expect(field).toBeDefined();
    expect(field?.label).toBe("Customer Tier");
    expect(field?.type).toBe("select");
    expect(field?.options).toEqual(["Gold", "Silver"]);
    expect(field?.isCustom).toBe(true);
  });

  it("parses option objects as well as plain strings", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({
        id: "cf-2",
        field_name: "Route",
        field_type: "select",
        source_type: "module",
        module_name: "contact",
        field_options: [{ label: "North" }, { value: "South" }],
      }),
    ]);
    expect(findField(groups, "customer.custom:cf-2")?.options).toEqual(["North", "South"]);
  });

  it("does not treat a static registry row as a custom field", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({ id: "cf-3", source_type: "static", module_name: "contact" }),
    ]);
    expect(findField(groups, "customer.custom:cf-3")).toBeUndefined();
  });

  it("normalises unrecognised field types to text rather than dropping the field", () => {
    const { groups } = buildFieldCatalog("customer", [
      row({ id: "cf-4", field_type: "something-new", source_type: "module", module_name: "contact" }),
    ]);
    expect(findField(groups, "customer.custom:cf-4")?.type).toBe("text");
  });
});

describe("buildFieldCatalog — order status options", () => {
  it("attaches the real status list to the status field when supplied", () => {
    // The status list must come from the enforced transition machine, not the
    // order_statuses settings table, which does not match it in production.
    const { groups } = buildFieldCatalog("order", [], {
      order: ["Pending", "Approved", "Part Dispatch", "Dispatched", "Rejected", "Cancelled", "Closed"],
    });
    expect(findField(groups, "order.status")?.options).toContain("Part Dispatch");
  });

  it("falls back to the enforced seven statuses when no list is supplied", () => {
    const { groups } = buildFieldCatalog("order", []);
    expect(findField(groups, "order.status")?.options).toEqual([
      "Pending",
      "Approved",
      "Part Dispatch",
      "Dispatched",
      "Rejected",
      "Cancelled",
      "Closed",
    ]);
  });

  it("never offers a status the state machine cannot reach", () => {
    // The retired order_statuses table held 'Placed' and 'Accepted'. An
    // automation built on either would have matched nothing, forever.
    const { groups } = buildFieldCatalog("order", []);
    const options = findField(groups, "order.status")?.options ?? [];
    expect(options).not.toContain("Placed");
    expect(options).not.toContain("Accepted");
  });
});

describe("fieldTypeMap", () => {
  it("maps every catalog key to its type for the condition evaluator", () => {
    const { groups } = buildFieldCatalog("order", []);
    const types = fieldTypeMap(groups);
    expect(types.get("order.total_amount")).toBe("number");
    expect(types.get("order.date")).toBe("date");
    expect(types.get("customer.state")).toBe("text");
    expect(types.get("customer.phone")).toBe("phone");
  });
});

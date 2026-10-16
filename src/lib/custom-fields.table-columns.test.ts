// ============================================================
// Column headings and visibility come from the account's own field
// configuration, matched to columns by system key. Getting that match wrong
// is invisible in code review and obvious to a customer: on the customers
// table BOTH headings read "Contact Person", one of them above the company
// name, because the company column's id happens to be "name".
// ============================================================
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import type { CustomField } from "@/types";
import { getVisibleTableColumns } from "./custom-fields";

type Row = Record<string, unknown>;

const field = (over: Partial<CustomField>): CustomField =>
  ({
    id: Math.random().toString(36).slice(2),
    account_id: "a1",
    module_name: "contact",
    field_name: "Field",
    field_type: "text",
    is_required: false,
    is_active: true,
    show_in_table: true,
    position: 0,
    system_key: null,
    ...over,
  }) as CustomField;

/** The customers table as it really is: a company column whose id is "name". */
function contactColumns(): ColumnDef<Row>[] {
  return [
    { id: "name", systemKey: "company", label: "Company Name", type: "text" },
    { id: "contact_person", systemKey: "name", label: "Contact Person", type: "text" },
    { id: "phone", label: "Phone", type: "text" },
  ];
}

const CONTACT_FIELDS = [
  field({ system_key: "company", field_name: "Company Name" }),
  field({ system_key: "name", field_name: "Contact Person" }),
  field({ system_key: "phone", field_name: "Phone Number" }),
];

describe("getVisibleTableColumns — system key matching", () => {
  it("labels the company column from the company field, not from 'name'", () => {
    const cols = getVisibleTableColumns(contactColumns(), CONTACT_FIELDS, []);
    const company = cols.find((c) => c.id === "name")!;
    expect(company.label).toBe("Company Name");
  });

  it("never renders the same heading twice", () => {
    const cols = getVisibleTableColumns(contactColumns(), CONTACT_FIELDS, []);
    const labels = cols.map((c) => c.label);
    expect(new Set(labels).size, `duplicate headings: ${labels.join(", ")}`).toBe(
      labels.length,
    );
  });

  it("honours an account that renamed its company field", () => {
    const renamed = [
      field({ system_key: "company", field_name: "Firm" }),
      field({ system_key: "name", field_name: "Owner" }),
    ];
    const cols = getVisibleTableColumns(contactColumns(), renamed, []);
    expect(cols.find((c) => c.id === "name")!.label).toBe("Firm");
    expect(cols.find((c) => c.id === "contact_person")!.label).toBe("Owner");
  });

  it("hides the company column by default when the COMPANY field is hidden", () => {
    const fields = [
      field({ system_key: "company", field_name: "Company Name", show_in_table: false }),
      field({ system_key: "name", field_name: "Contact Person" }),
    ];
    const cols = getVisibleTableColumns(contactColumns(), fields, []);
    // Still listed, so Manage Column can offer it back…
    expect(cols.map((c) => c.id)).toContain("name");
    // …but off until the user asks for it.
    expect(cols.find((c) => c.id === "name")!.visibleByDefault).toBe(false);
    // The other column is untouched. This is the system-key mismatch guard.
    expect(cols.find((c) => c.id === "contact_person")!.visibleByDefault).not.toBe(false);
  });

  it("hides the contact-person column by default when the NAME field is hidden", () => {
    // Previously this hid the company column instead — the same mismatch,
    // with a worse outcome than a wrong heading.
    const fields = [
      field({ system_key: "company", field_name: "Company Name" }),
      field({ system_key: "name", field_name: "Contact Person", show_in_table: false }),
    ];
    const cols = getVisibleTableColumns(contactColumns(), fields, []);
    expect(cols.find((c) => c.id === "contact_person")!.visibleByDefault).toBe(false);
    expect(cols.find((c) => c.id === "name")!.visibleByDefault).not.toBe(false);
  });

  // ==========================================================
  // A hidden column must stay in the list, because a removed column never
  // reaches ManageColumnsDialog and so can never be switched back on. That is
  // how Leads lost Area, Pincode, WhatsApp, Address, City, State and Country
  // from Manage Column entirely — 32 fields across 10 modules were in that
  // state. Only a field DEACTIVATED in Field Settings removes its column.
  // ==========================================================
  it("removes a column whose field was deactivated", () => {
    const fields = [
      field({ system_key: "company", field_name: "Company Name", is_active: false }),
      field({ system_key: "name", field_name: "Contact Person" }),
    ];
    const ids = getVisibleTableColumns(contactColumns(), fields, []).map((c) => c.id);
    expect(ids).not.toContain("name");
    expect(ids).toContain("contact_person");
  });

  it("keeps every column when the account has no field rows at all", () => {
    // Three live tenants are in exactly this state: predefined fields are
    // seeded the first time a form builder is opened, so an account that has
    // never opened one has no rows. Absence must never mean "off".
    const before = contactColumns().map((c) => c.id);
    const after = getVisibleTableColumns(contactColumns(), [], []).map((c) => c.id);
    expect(after).toEqual(before);
    expect(after.every((id) => id)).toBe(true);
    for (const col of getVisibleTableColumns(contactColumns(), [], [])) {
      expect(col.visibleByDefault).not.toBe(false);
      expect(col.type).toBe("text");
    }
  });

  it("does not edit the columns it was handed", () => {
    // The screens pass a memoised array. Editing it in place outlives the
    // render, so switching a field back on in Field Settings would not bring
    // its column back until a full page reload.
    const original = contactColumns();
    getVisibleTableColumns(original, [
      field({ system_key: "company", field_name: "Renamed", show_in_table: false, is_filterable: false }),
    ], []);
    expect(original[0].label).toBe("Company Name");
    expect(original[0].visibleByDefault).toBeUndefined();
    expect(original[0].type).toBe("text");
  });

  it("brings a column back once its field is shown again", () => {
    const columns = contactColumns();
    const hidden = getVisibleTableColumns(columns, [
      field({ system_key: "company", field_name: "Company Name", show_in_table: false }),
    ], []);
    expect(hidden.find((c) => c.id === "name")!.visibleByDefault).toBe(false);

    const shown = getVisibleTableColumns(columns, [
      field({ system_key: "company", field_name: "Company Name", show_in_table: true }),
    ], []);
    expect(shown.find((c) => c.id === "name")!.visibleByDefault).not.toBe(false);
  });

  it("drops the filter from a column whose field is not filterable", () => {
    // No new flag: a column with no `type` renders no filter cell, which is
    // the same contract appendCustomFieldColumns already uses.
    const fields = [
      field({ system_key: "company", field_name: "Company Name", is_filterable: false }),
      field({ system_key: "name", field_name: "Contact Person" }),
    ];
    const cols = getVisibleTableColumns(contactColumns(), fields, []);
    expect(cols.find((c) => c.id === "name")!.type).toBeUndefined();
    expect(cols.find((c) => c.id === "contact_person")!.type).toBe("text");
    // No field row for this one, so it stays filterable.
    expect(cols.find((c) => c.id === "phone")!.type).toBe("text");
  });

  it("falls back to the column id when no systemKey is declared", () => {
    const cols = getVisibleTableColumns(contactColumns(), CONTACT_FIELDS, []);
    expect(cols.find((c) => c.id === "phone")!.label).toBe("Phone Number");
  });

  it("leaves a column alone when no field configures it", () => {
    const cols = getVisibleTableColumns(
      [{ id: "assigned_employee", label: "Assigned Employee" }],
      CONTACT_FIELDS,
      [],
    );
    expect(cols[0].label).toBe("Assigned Employee");
  });

  it("always keeps the actions column", () => {
    const cols = getVisibleTableColumns(
      [{ id: "actions", label: "Action" }],
      [field({ system_key: "actions", field_name: "x", show_in_table: false })],
      [],
    );
    expect(cols.map((c) => c.id)).toContain("actions");
  });
});

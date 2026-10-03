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

  it("hides the company column when the COMPANY field is hidden", () => {
    const fields = [
      field({ system_key: "company", field_name: "Company Name", show_in_table: false }),
      field({ system_key: "name", field_name: "Contact Person" }),
    ];
    const ids = getVisibleTableColumns(contactColumns(), fields, []).map((c) => c.id);
    expect(ids).not.toContain("name");
    expect(ids).toContain("contact_person");
  });

  it("hides the contact-person column when the NAME field is hidden", () => {
    // Previously this hid the company column instead — the same mismatch,
    // with a worse outcome than a wrong heading.
    const fields = [
      field({ system_key: "company", field_name: "Company Name" }),
      field({ system_key: "name", field_name: "Contact Person", show_in_table: false }),
    ];
    const ids = getVisibleTableColumns(contactColumns(), fields, []).map((c) => c.id);
    expect(ids).toContain("name");
    expect(ids).not.toContain("contact_person");
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

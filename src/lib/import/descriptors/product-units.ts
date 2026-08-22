import type { ImportDescriptor } from "../types";

// Wave 0 pilot descriptor. Product Units is the lowest-risk true test of the
// engine: flat, no parent, no financial impact, no lookups. The commit RPC's
// `product_units` branch mirrors these fields.
export const productUnitsDescriptor: ImportDescriptor = {
  module: "product_units",
  targetTable: "product_units",
  label: "Product Units",
  // No extra permission: product_units RLS already limits writes to admin/owner,
  // and `import_data` gates the button. import_manage (admin) gates undo.
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 5000,
  fields: [
    {
      key: "name",
      label: "Unit Name",
      required: true,
      unique: true,
      type: "text",
      maxLength: 100,
      synonyms: ["unit", "unitname", "uom", "measure", "measurename", "unitofmeasure"],
      sample: "Kilograms",
      examples: ["Kilograms", "Grams", "Pieces"],
    },
    {
      key: "short_name",
      label: "Short Name",
      required: false,
      type: "text",
      maxLength: 20,
      synonyms: ["short", "shortname", "symbol", "code", "abbreviation", "abbr"],
      sample: "kg",
      examples: ["kg", "g", "pcs"],
    },
  ],
};

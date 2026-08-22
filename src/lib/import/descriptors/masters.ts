import type { ImportDescriptor } from "../types";

// Wave 1 master-data descriptors. Each maps to a branch in the import_commit /
// import_undo RPCs (migration 20260822170000). Lookups (category/unit/tax on
// products, territory on customers) are resolved best-effort by name server-side;
// unknown names don't fail a row (the text is kept, the FK left null).

export const productCategoriesDescriptor: ImportDescriptor = {
  module: "product_categories",
  targetTable: "product_categories",
  label: "Product Categories",
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 10000,
  fields: [
    { key: "name", label: "Category", required: true, unique: true, type: "text", maxLength: 100,
      synonyms: ["category", "categoryname", "name"], examples: ["Men's wear", "Footwear", "Accessories"] },
    { key: "parent", label: "Parent Category", type: "text", maxLength: 100,
      synonyms: ["parent", "parentcategory", "parentname", "subcategoryof"], examples: ["", "Men's wear", ""] },
  ],
};

// Products is FORM-BACKED (see build-descriptor.ts): its fields + required rules
// come from the `custom_fields` config for module_name='product', including any
// admin custom fields. Category/Unit/Tax values are resolved to ids best-effort
// server-side. `fields` below is just the name fallback that guarantees the
// dedupe key exists even if a tenant hid the name field.
export const productsDescriptor: ImportDescriptor = {
  module: "products",
  targetTable: "products",
  label: "Products",
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 20000,
  formBacked: true,
  fieldsModule: "product",
  customValuesTable: "product_custom_values",
  customValuesFk: "product_id",
  systemColumns: ["name", "sku", "description", "price", "category", "unit", "tax", "hsn_code", "min_price", "opening_stock"],
  lookups: [
    { field: "category", table: "product_categories", matchColumns: ["name"], createable: "admin", hierarchical: true },
    // Units & tax slabs carry business meaning (a tax slab needs a rate) — never
    // auto-created from a name; the admin maps them or leaves them blank.
    { field: "unit", table: "product_units", matchColumns: ["name"], createable: "never" },
    { field: "tax", table: "tax_slabs", matchColumns: ["name"], createable: "never" },
  ],
  fields: [
    { key: "name", label: "Product Name", required: true, type: "text", maxLength: 200,
      synonyms: ["product", "productname", "itemname", "name"], examples: ["Blue T-Shirt", "Running Shoes"] },
  ],
};

// Customers is FORM-BACKED: its predefined + custom fields (and their required
// rules) are generated at runtime from the `custom_fields` config for
// module_name='contact' (see build-descriptor.ts). The `fields` below are only
// the synthetic/gated extras the form adds outside that config — territory,
// lat/long, and financials — plus a phone fallback that guarantees the dedupe key.
export const contactsDescriptor: ImportDescriptor = {
  module: "contacts",
  targetTable: "contacts",
  label: "Customers",
  undoable: true,
  dedupeKeys: ["phone"],
  maxRows: 50000,
  formBacked: true,
  fieldsModule: "contact",
  customValuesTable: "contact_custom_values",
  customValuesFk: "contact_id",
  systemColumns: ["name", "phone", "email", "company", "whatsapp", "address", "area", "city", "state", "country", "pincode"],
  territoryReplacesKeys: ["country", "state", "city", "area"],
  lookups: [
    { field: "territory", table: "territories", matchColumns: ["name"], createable: "admin", hierarchical: true },
  ],
  fields: [
    { key: "phone", label: "Phone", required: true, unique: true, type: "phone",
      synonyms: ["phone", "mobile", "number", "contactnumber"], examples: ["+919876543210", "+919812345678", ""] },
    { key: "territory", label: "Territory", type: "text", maxLength: 100,
      synonyms: ["territory", "zone", "beat", "salesarea", "region"], examples: ["Gujarat", "", ""] },
    { key: "latitude", label: "Latitude", type: "latlng", synonyms: ["latitude", "lat"], examples: ["", "", ""] },
    { key: "longitude", label: "Longitude", type: "latlng", synonyms: ["longitude", "lng", "long"], examples: ["", "", ""] },
    { key: "credit_limit", label: "Credit Limit", type: "number", synonyms: ["creditlimit"], examples: ["", "", ""] },
    { key: "credit_days", label: "Credit Days", type: "integer", synonyms: ["creditdays"], examples: ["", "", ""] },
    { key: "opening_balance", label: "Opening Balance", type: "number", synonyms: ["openingbalance", "balance", "outstanding"], examples: ["", "", ""] },
  ],
};

// Leads is FORM-BACKED: fields + required rules come from the `custom_fields`
// config for module_name='lead' (predefined + custom). `fields` is the name
// fallback for the dedupe key.
export const leadsDescriptor: ImportDescriptor = {
  module: "leads",
  targetTable: "leads",
  label: "Leads",
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 50000,
  formBacked: true,
  fieldsModule: "lead",
  customValuesTable: "lead_custom_values",
  customValuesFk: "lead_id",
  systemColumns: ["name", "phone", "whatsapp", "email", "contact_person", "company", "source", "status", "industry", "address", "city", "state", "country"],
  fields: [
    { key: "name", label: "Lead Name", required: true, type: "text", maxLength: 200,
      synonyms: ["name", "leadname", "businessname", "business"], examples: ["Acme Corp", "Zeta Retail"] },
  ],
};

export const territoriesDescriptor: ImportDescriptor = {
  module: "territories",
  targetTable: "territories",
  label: "Territories",
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 50000,
  fields: [
    { key: "name", label: "Territory", required: true, type: "text", maxLength: 120,
      synonyms: ["name", "territory", "territoryname", "zone", "region"], examples: ["Gujarat", "Rajkot", "Rajkot East"] },
    { key: "parent", label: "Parent Territory", type: "text", maxLength: 120,
      synonyms: ["parent", "parentterritory", "parentname"], examples: ["", "Gujarat", "Rajkot"] },
    { key: "code", label: "Code", type: "text", maxLength: 40, synonyms: ["code", "territorycode"], examples: ["GJ", "RJK", "RJK-E"] },
    { key: "notes", label: "Notes", type: "text", maxLength: 300, synonyms: ["notes", "remarks"], examples: ["", "", ""] },
  ],
};

export const tasksDescriptor: ImportDescriptor = {
  module: "tasks",
  targetTable: "tasks",
  label: "Tasks",
  undoable: true,
  dedupeKeys: ["title"],
  maxRows: 20000,
  fields: [
    { key: "title", label: "Title", required: true, type: "text", maxLength: 200,
      synonyms: ["title", "task", "taskname", "subject", "name"], examples: ["Call ABC Traders", "Follow up quote"] },
    { key: "description", label: "Description", type: "text", maxLength: 1000, synonyms: ["description", "details", "notes"], examples: ["", ""] },
    { key: "priority", label: "Priority", type: "text", allowed: ["Low", "Medium", "High", "Urgent"],
      synonyms: ["priority"], examples: ["Medium", "High"] },
    { key: "status", label: "Status", type: "text", allowed: ["Pending", "In Progress", "Waiting", "Completed", "Cancelled"],
      synonyms: ["status"], examples: ["Pending", "Pending"] },
    { key: "due_date", label: "Due Date", type: "date", synonyms: ["duedate", "date", "deadline"], examples: ["2026-09-01", "2026-09-05"] },
    { key: "activity_type", label: "Activity Type", type: "text", maxLength: 40, synonyms: ["activitytype", "type"], examples: ["Call", "Meeting"] },
  ],
};

export const priceListsDescriptor: ImportDescriptor = {
  module: "price_lists",
  targetTable: "price_lists",
  label: "Price Lists",
  undoable: true,
  dedupeKeys: ["name"],
  maxRows: 5000,
  fields: [
    { key: "name", label: "Price List Name", required: true, unique: true, type: "text", maxLength: 120,
      synonyms: ["name", "pricelist", "pricelistname"], examples: ["Distributor", "Retail"] },
    { key: "blanket_discount_percent", label: "Blanket Discount %", type: "number",
      synonyms: ["discount", "blanketdiscount", "discountpercent"], examples: ["10", "0"] },
  ],
};

export const WAVE1_DESCRIPTORS: ImportDescriptor[] = [
  productCategoriesDescriptor,
  productsDescriptor,
  contactsDescriptor,
  leadsDescriptor,
  territoriesDescriptor,
  tasksDescriptor,
  priceListsDescriptor,
];

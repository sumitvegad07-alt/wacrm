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
    { key: "status", label: "Status", type: "text", allowed: ["active", "inactive", "archived"], synonyms: ["status"], examples: ["active", "active", "active"] },
  ],
};

// Tasks is FORM-BACKED: its fields + required rules come from the `custom_fields`
// config for module_name='task' (plus custom fields). The `fields` below are the
// always-present core of the manual task form (title, description, priority,
// status, dates, activity type) and the Assigned-To lookup (resolved to a
// profile by name/email server-side). "Linked to" (contact/deal/…) is deferred —
// it's a per-record link, not typically set in a bulk import.
export const tasksDescriptor: ImportDescriptor = {
  module: "tasks",
  targetTable: "tasks",
  label: "Tasks",
  undoable: true,
  dedupeKeys: ["title"],
  maxRows: 20000,
  formBacked: true,
  fieldsModule: "task",
  customValuesTable: "task_custom_values",
  customValuesFk: "task_id",
  systemColumns: ["title", "description", "priority", "status", "due_date", "due_time", "activity_type"],
  fields: [
    { key: "title", label: "Title", required: true, type: "text", maxLength: 200,
      synonyms: ["title", "task", "taskname", "subject", "name"], examples: ["Call ABC Traders", "Follow up quote"] },
    { key: "description", label: "Description", type: "text", maxLength: 1000, synonyms: ["description", "details", "notes"], examples: ["", ""] },
    { key: "priority", label: "Priority", type: "text", allowed: ["Low", "Medium", "High", "Urgent"],
      synonyms: ["priority"], examples: ["Medium", "High"] },
    { key: "status", label: "Status", type: "text", allowed: ["Pending", "In Progress", "Waiting", "Completed", "Cancelled"],
      synonyms: ["status"], examples: ["Pending", "Pending"] },
    { key: "due_date", label: "Scheduled Date", type: "date", synonyms: ["duedate", "date", "deadline", "scheduleddate"], examples: ["2026-09-01", "2026-09-05"] },
    { key: "due_time", label: "Scheduled Time", type: "text", synonyms: ["duetime", "time", "scheduledtime"], examples: ["10:00", "14:30"] },
    { key: "activity_type", label: "Activity Type", type: "text", maxLength: 40, synonyms: ["activitytype", "type"], examples: ["Call", "Meeting"] },
    { key: "assignee", label: "Assigned To", type: "text", maxLength: 120,
      synonyms: ["assignee", "assignedto", "assigned", "owner", "rep", "salesperson"], examples: ["Ravi Kumar", ""] },
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

// Outstanding = set each customer's opening balance. Match-required: every row
// must match an existing customer by phone; the balance is then updated. No new
// customers are created. (Commit dispatches on targetTable 'outstanding' → the
// contacts.opening_balance branch; keyTable 'contacts' is where matches live.)
export const outstandingDescriptor: ImportDescriptor = {
  module: "outstanding",
  targetTable: "outstanding",
  label: "Outstanding",
  undoable: false,
  requiresExistingMatch: true,
  keyTable: "contacts",
  dedupeKeys: ["phone"],
  maxRows: 50000,
  fields: [
    { key: "phone", label: "Customer Phone", required: true, type: "phone",
      synonyms: ["phone", "mobile", "number", "customerphone", "contactnumber"], examples: ["+919876543210", "+919812345678"] },
    { key: "opening_balance", label: "Opening Balance", required: true, type: "number",
      synonyms: ["openingbalance", "balance", "outstanding", "amount", "due"], examples: ["5000", "0"] },
  ],
};

// Opening Stock = set each product's opening stock balance. Match-required by
// SKU or product name (an existing product). Commit dispatches on 'stock' →
// products.opening_stock; keyTable 'products'.
export const stockDescriptor: ImportDescriptor = {
  module: "stock",
  targetTable: "stock",
  label: "Opening Stock",
  undoable: false,
  requiresExistingMatch: true,
  keyTable: "products",
  dedupeKeys: ["name"],
  maxRows: 50000,
  fields: [
    { key: "name", label: "Product", required: true, type: "text",
      synonyms: ["product", "productname", "item", "itemname", "name"], examples: ["Blue T-Shirt", "Running Shoes"] },
    { key: "sku", label: "SKU", type: "text",
      synonyms: ["sku", "code", "itemcode", "productcode"], examples: ["TSHIRT-001", "SHOE-045"] },
    { key: "opening_stock", label: "Opening Stock", required: true, type: "number",
      synonyms: ["openingstock", "stock", "qty", "quantity", "onhand"], examples: ["100", "40"] },
  ],
};

// NOTE: priceListsDescriptor is intentionally NOT registered — there is no Price
// List module in the product yet (the price_lists table is a dormant backing table
// with no create/manage UI), so offering its import would be orphaned. Re-add it
// here once a real Price List module ships.
export const WAVE1_DESCRIPTORS: ImportDescriptor[] = [
  productCategoriesDescriptor,
  productsDescriptor,
  contactsDescriptor,
  leadsDescriptor,
  territoriesDescriptor,
  tasksDescriptor,
  outstandingDescriptor,
  stockDescriptor,
];

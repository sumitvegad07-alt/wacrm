import type { ImportDescriptor } from "../types";
import { ASSET_STATUSES } from "@/lib/service/assets/filters";

// FSM Phase 1: Service Assets import. Maps to the `customer_assets` branch of the
// import_commit / import_undo RPCs (migration 20260929155000_fsm_import_customer_assets).
//
// STRICT LOOKUPS. A previous importer silently created 15 bogus Country-level
// territories for one tenant, which had to be reparented by hand. So this importer
// resolves, it never invents:
//   * customer   -> an EXISTING customer, by customer code, then phone (digits only; exact,
//                   then a last-10-digits match accepted ONLY when it is unique), then exact name. A customer is NEVER created. No match fails the
//                   row (customer_not_found); two matches fail it too (customer_ambiguous).
//   * asset_type -> by name, case-insensitive. Created ONLY when the user ticks
//                   "Create missing asset types" (off by default); otherwise a missing
//                   type fails the row.
//   * product    -> by product code (sku), then name. A product is NEVER created.
//   * There is NO territory field, not even an ignored one. The database trigger gives
//     every asset its customer's territory. A "Territory" column in the file simply
//     stays unmapped.
//   * asset_code, customer_name_snapshot and customer_phone_snapshot are owned by the
//     database trigger and are never accepted from the file.
//
// There are deliberately no `lookups` entries: those drive the guided-resolve step, which
// offers "Create new ..." and would defeat the rules above. Resolution happens in the RPC,
// where a miss is a named row error.
//
// INSERT-ONLY. Updating an existing asset from a file is not offered, so `insertOnly` hides
// the Skip/Update choice and duplicates are sent to the server, which fails each with
// `duplicate_serial` naming the existing asset's code.
export const customerAssetsDescriptor: ImportDescriptor = {
  module: "customer_assets",
  targetTable: "customer_assets",
  label: "Service Assets",
  requiredPermission: "import_service_assets",
  undoable: true,
  dedupeKeys: ["serial_no"],
  insertOnly: true,
  // Shown in the wizard (upload and mapping steps). The shared reader converts real .xlsx date
  // cells to ISO before validation (see lib/import/parse), so this only has to state the rule
  // for dates typed as text — where a two-digit year stays genuinely ambiguous.
  help: "Dates: use yyyy-mm-dd, dd-mm-yyyy or dd/mm/yyyy. A two-digit year is rejected rather than guessed.",
  // 10x the chunk size. Each 500-row chunk is its own transaction, which is what keeps the
  // tenant's single account_sequences row lock short (see run.ts CHUNK_SIZE).
  maxRows: 5000,
  options: [
    {
      key: "create_asset_types",
      label: "Create missing asset types",
      description:
        "Off by default. When off, a row naming an asset type you do not have fails with a clear reason. When on, each new type name is added to your Asset Types.",
    },
  ],
  fields: [
    {
      key: "customer",
      label: "Customer",
      required: true,
      type: "text",
      maxLength: 200,
      synonyms: [
        "customer", "customername", "customercode", "customerid", "custcode", "client", "clientname",
        "party", "partyname", "mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber",
        "contactnumber",
      ],
      sample: "Acme Foods",
      examples: ["Acme Foods", "+919876543210", "C-0042"],
    },
    {
      key: "asset_type",
      label: "Asset Type",
      type: "text",
      maxLength: 100,
      synonyms: ["assettype", "type", "category", "equipmenttype", "machinetype"],
      examples: ["Water Purifier", "Air Conditioner", "Generator"],
    },
    {
      key: "product",
      label: "Product",
      type: "text",
      maxLength: 200,
      synonyms: ["product", "productname", "productcode", "sku", "itemcode"],
      examples: ["", "", ""],
    },
    {
      key: "name",
      label: "Asset Name",
      required: true,
      type: "text",
      maxLength: 200,
      synonyms: ["assetname", "machine", "machinename", "equipment", "equipmentname"],
      examples: ["RO plant - lobby", "Split AC 1.5T", "DG set 25kVA"],
    },
    {
      key: "make",
      label: "Make",
      type: "text",
      maxLength: 100,
      synonyms: ["brand", "manufacturer", "oem"],
      examples: ["Kent", "Voltas", "Kirloskar"],
    },
    {
      key: "model_no",
      label: "Model No",
      type: "text",
      maxLength: 100,
      synonyms: ["model", "modelnumber"],
      examples: ["KR-100", "VX-15", "KG-25"],
    },
    {
      key: "serial_no",
      label: "Serial No",
      unique: true,
      type: "text",
      maxLength: 100,
      synonyms: ["serial", "serialnumber"],
      examples: ["SN-100234", "SN-100235", ""],
    },
    {
      key: "installation_date",
      label: "Installation Date",
      type: "date_dmy",
      synonyms: ["installed", "installdate", "installedon", "dateofinstallation", "commissioningdate", "installation"],
      examples: ["15-03-2024", "02/11/2023", "2024-01-20"],
    },
    {
      key: "warranty_start",
      label: "Warranty Start",
      type: "date_dmy",
      synonyms: ["warrantystartdate", "warrantyfrom"],
      examples: ["15-03-2024", "", ""],
    },
    {
      key: "warranty_end",
      label: "Warranty End",
      type: "date_dmy",
      synonyms: ["warrantyenddate", "warrantyto", "warrantyexpiry", "warrantyexpirydate", "warrantyuntil"],
      examples: ["14-03-2026", "", ""],
    },
    {
      key: "status",
      label: "Status",
      type: "text",
      allowed: [...ASSET_STATUSES],
      synonyms: ["assetstatus", "condition"],
      examples: ["active", "under_repair", ""],
    },
    {
      key: "site_label",
      label: "Site",
      type: "text",
      maxLength: 200,
      synonyms: ["sitename", "sitelabel", "location", "installationsite"],
      examples: ["Lobby", "Server room", "Yard"],
    },
    {
      key: "notes",
      label: "Notes",
      type: "text",
      maxLength: 2000,
      synonyms: ["note", "remarks", "comments"],
      examples: ["", "Needs quarterly service", ""],
    },
  ],
};

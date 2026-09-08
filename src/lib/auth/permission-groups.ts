import { ROUTE_PERMISSION_GROUPS } from "@/lib/route/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";

/**
 * Single source of truth for the role-editor "Rights" catalogue.
 *
 * Moved out of the roles page so the command palette can index the same rows
 * (and deep-link to them) without maintaining a second copy that drifts. The
 * roles page re-imports `PERMISSION_GROUPS`, `PermGroup` and `PermLine` from
 * here; the palette uses the derived `PERMISSION_INDEX`.
 */
export type PermLine = "crm" | "sfa" | "wfa";

export type PermGroup = {
  category: string;
  // A permission may carry its own `line` when it sits inside an otherwise
  // always-shown group but belongs to a single product line (e.g. the
  // "Lead & Deal Reports" right inside the shared Reports group). It's hidden
  // when the account's plan doesn't own that line.
  permissions: { id: string; label: string; line?: PermLine }[];
  danger?: boolean;
  note?: string;
};

// Shown on sections whose features live only in the Web admin portal (masters, settings, imports,
// WhatsApp, team & roles). The mobile app has no screens for these, so ticking them changes nothing
// on a phone. The banner stops admins expecting a mobile effect.
export const WEB_ONLY_NOTE =
  "🖥️ These rights apply to the Web admin portal only — they have no effect on the mobile app.";

export const PERMISSION_GROUPS: PermGroup[] = [
  {
    // Base right — the home dashboard exists on every plan (its sections adapt to
    // the plan), so this must NOT be line-gated. Kept out of GROUP_LINE so a
    // WFA/SFA-only account can still grant it on web + mobile.
    category: "Dashboard",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_DASHBOARD, label: "View Dashboard" },
    ],
  },
  {
    category: "Leads",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_LEADS, label: "View Leads" },
      { id: PERMISSIONS.CRM.CREATE_LEADS, label: "Create Leads" },
      { id: PERMISSIONS.CRM.EDIT_LEADS, label: "Edit Leads" },
      { id: PERMISSIONS.CRM.DELETE_LEADS, label: "Delete Leads" },
      { id: PERMISSIONS.CRM.CONVERT_LEADS, label: "Convert Lead to Customer" },
      { id: PERMISSIONS.CRM.ASSIGN_LEADS, label: "Assign Leads to Others" },
      { id: PERMISSIONS.CRM.IMPORT_LEADS, label: "Import Leads" },
      { id: PERMISSIONS.CRM.EXPORT_LEADS, label: "Export Leads" },
    ]
  },
  {
    category: "Deals / Pipeline",
    permissions: [
      { id: PERMISSIONS.DEALS.VIEW, label: "View Deals" },
      { id: PERMISSIONS.DEALS.CREATE, label: "Create Deals" },
      { id: PERMISSIONS.DEALS.EDIT, label: "Edit Deals" },
      { id: PERMISSIONS.DEALS.DELETE, label: "Delete Deals" },
      { id: PERMISSIONS.DEALS.MOVE_STAGE, label: "Move Deal Between Stages" },
      { id: PERMISSIONS.DEALS.CONVERT_TO_QUOTATION, label: "Convert Deal to Quotation" },
      { id: PERMISSIONS.DEALS.EXPORT, label: "Export Deals" },
    ]
  },
  {
    category: "Quotations",
    permissions: [
      { id: PERMISSIONS.QUOTATIONS.VIEW, label: "View Quotations" },
      { id: PERMISSIONS.QUOTATIONS.CREATE, label: "Create Quotations" },
      { id: PERMISSIONS.QUOTATIONS.EDIT, label: "Edit Quotations" },
      { id: PERMISSIONS.QUOTATIONS.DELETE, label: "Delete Quotations" },
      { id: PERMISSIONS.QUOTATIONS.PRINT, label: "Print / Export Quotation PDF" },
      { id: PERMISSIONS.QUOTATIONS.SHARE, label: "Share Quotation (PDF / Link)" },
    ]
  },
  {
    category: "Customers",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_CONTACTS, label: "View Customers" },
      { id: PERMISSIONS.CRM.CREATE_CONTACTS, label: "Create Customers" },
      { id: PERMISSIONS.CRM.EDIT_CONTACTS, label: "Edit Customers" },
      { id: PERMISSIONS.CRM.DELETE_CONTACTS, label: "Delete Customers" },
      { id: PERMISSIONS.CRM.IMPORT_CONTACTS, label: "Import Customers" },
      { id: PERMISSIONS.CRM.EXPORT_CONTACTS, label: "Export Customers" },
    ]
  },
  {
    category: "Catalogue (Products)",
    permissions: [
      { id: PERMISSIONS.CATALOGUE.VIEW_PRODUCTS, label: "View Products" },
      { id: PERMISSIONS.CATALOGUE.CREATE_PRODUCTS, label: "Create Products" },
      { id: PERMISSIONS.CATALOGUE.EDIT_PRODUCTS, label: "Edit Products" },
      { id: PERMISSIONS.CATALOGUE.DELETE_PRODUCTS, label: "Delete Products" },
      { id: PERMISSIONS.CATALOGUE.IMPORT_PRODUCTS, label: "Import Products" },
      { id: PERMISSIONS.CATALOGUE.EXPORT_PRODUCTS, label: "Export Products" },
      { id: PERMISSIONS.CATALOGUE.MANAGE_UNITS, label: "Manage Product Units" },
      { id: PERMISSIONS.CATALOGUE.MANAGE_CATEGORIES, label: "Manage Product Categories / Sub-categories" },
    ]
  },
  {
    category: "Orders",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_ORDERS, label: "View Orders" },
      { id: PERMISSIONS.CRM.CREATE_ORDERS, label: "Create Orders" },
      { id: PERMISSIONS.CRM.EDIT_ORDERS, label: "Edit Orders" },
      { id: PERMISSIONS.CRM.DELETE_ORDERS, label: "Delete Orders" },
      { id: PERMISSIONS.CRM.APPLY_ORDER_DISCOUNT, label: "Apply Discounts on Orders" },
      { id: PERMISSIONS.CRM.OVERRIDE_ORDER_PRICE, label: "Change Product Price on a Line" },
      { id: PERMISSIONS.CRM.EDIT_ORDER_TAX, label: "Edit Tax on an Order" },
      { id: PERMISSIONS.CRM.MANAGE_ORDER_STATUS, label: "Manage Order Status (approve / reject / cancel)" },
      { id: PERMISSIONS.CRM.IMPORT_ORDERS, label: "Import Orders" },
      { id: PERMISSIONS.CRM.EXPORT_ORDERS, label: "Export Orders" },
      { id: PERMISSIONS.CRM.SHARE_ORDERS, label: "Share Order (PDF / Link)" },
    ]
  },
  {
    category: "Dispatch",
    permissions: [
      { id: PERMISSIONS.DISPATCH.VIEW, label: "View Dispatches" },
      { id: PERMISSIONS.DISPATCH.CREATE, label: "Create Dispatch" },
      { id: PERMISSIONS.DISPATCH.EDIT, label: "Edit Dispatch" },
      { id: PERMISSIONS.DISPATCH.DELETE, label: "Delete Dispatch" },
      { id: PERMISSIONS.DISPATCH.IMPORT, label: "Import Dispatch" },
      { id: PERMISSIONS.DISPATCH.EXPORT, label: "Export Dispatch" },
      { id: PERMISSIONS.DISPATCH.SHARE, label: "Share Dispatch Details" },
      { id: PERMISSIONS.DISPATCH.TRANSPORT_COMPULSORY, label: "Transport Details Compulsory" },
    ]
  },
  {
    category: "Stock / Inventory",
    note: "On mobile, stock is view-only (gated by View Stock, shown while placing an order). Manage Stock and Import Opening Stock apply to the web app only.",
    permissions: [
      { id: PERMISSIONS.STOCK.VIEW, label: "View Stock (closing stock, ledger, report)" },
      { id: PERMISSIONS.STOCK.MANAGE, label: "Manage Stock — set opening, Stock In / Out adjustments (Web only)" },
      { id: PERMISSIONS.STOCK.IMPORT, label: "Import Opening Stock (Web only)" },
    ]
  },
  {
    category: "Data Import",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.IMPORT.DATA, label: "Import Data (upload files to bulk-add records)" },
      { id: PERMISSIONS.IMPORT.MANAGE, label: "Manage Imports (undo an import, save mapping templates, create missing values)" },
    ]
  },
  {
    category: "Payments & Finance",
    permissions: [
      { id: PERMISSIONS.PAYMENTS.VIEW, label: "View Payments" },
      { id: PERMISSIONS.PAYMENTS.CREATE, label: "Create / Collect Payments" },
      { id: PERMISSIONS.PAYMENTS.EDIT, label: "Edit Pending Payments" },
      { id: PERMISSIONS.PAYMENTS.CANCEL, label: "Cancel Payments" },
      { id: PERMISSIONS.PAYMENTS.APPROVE, label: "Approve Payments" },
      { id: PERMISSIONS.PAYMENTS.REJECT, label: "Reject Payments" },
      { id: PERMISSIONS.PAYMENTS.VIEW_ATTACHMENTS, label: "View Payment Attachments (Cheques, Receipts)" },
      { id: PERMISSIONS.PAYMENTS.VIEW_REPORTS, label: "View Payment Reports" },
      { id: PERMISSIONS.PAYMENTS.EXPORT_REPORTS, label: "Export Payment Reports" },
      { id: PERMISSIONS.PAYMENTS.BACKDATE, label: "Backdate Payments (beyond the allowed window)" },
    ]
  },
  {
    category: "Customer Financials",
    permissions: [
      { id: PERMISSIONS.CUSTOMERS.VIEW_OUTSTANDING, label: "View Customer Outstanding" },
      { id: PERMISSIONS.CUSTOMERS.VIEW_FINANCIALS, label: "View Customer Financial Details" },
      { id: PERMISSIONS.CUSTOMERS.VIEW_CUSTOMER_CREDIT_LIMIT, label: "View Credit Limit & Available Credit" },
      { id: PERMISSIONS.CUSTOMERS.VIEW_CUSTOMER_PAYMENT_HISTORY, label: "View Customer Payment History" },
      { id: PERMISSIONS.CUSTOMERS.MANAGE_CREDIT, label: "Manage Credit Limits & Terms" },
      { id: PERMISSIONS.CUSTOMERS.VIEW_OPENING_BALANCE, label: "View Opening Balance" },
      { id: PERMISSIONS.CUSTOMERS.EDIT_OPENING_BALANCE, label: "Edit Opening Balance" },
    ]
  },
  {
    category: "Task Management",
    permissions: [
      { id: PERMISSIONS.TASKS.VIEW, label: "View Tasks" },
      { id: PERMISSIONS.TASKS.CREATE, label: "Create Task" },
      { id: PERMISSIONS.TASKS.EDIT, label: "Edit Task" },
      { id: PERMISSIONS.TASKS.DELETE, label: "Delete Task" },
      { id: PERMISSIONS.TASKS.ASSIGN_PARENT, label: "Assign Tasks to Parent User" },
      { id: PERMISSIONS.TASKS.ASSIGN_CHILD, label: "Assign Tasks to Child User" },
      { id: PERMISSIONS.TASKS.ASSIGN_ALL, label: "Assign Tasks to All Users" },
    ]
  },
  {
    category: "WhatsApp Features",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.WHATSAPP.VIEW, label: "Access WhatsApp Dashboard" },
      { id: PERMISSIONS.WHATSAPP.SEND, label: "Send Message / Reply" },
      { id: PERMISSIONS.WHATSAPP.VIEW_BROADCASTS, label: "Manage Broadcasts" },
      { id: PERMISSIONS.WHATSAPP.VIEW_AUTOMATIONS, label: "Manage Automations" },
      { id: PERMISSIONS.WHATSAPP.VIEW_FLOWS, label: "Manage Workflows" },
      { id: PERMISSIONS.WHATSAPP.VIEW_TEMPLATES, label: "Manage Message Templates" },
      { id: PERMISSIONS.WHATSAPP.VIEW_AI_ASSISTANT, label: "Manage AI Knowledge Base" },
    ]
  },
  {
    category: "Route Management",
    // Sourced from the Route SDK's permission definitions so keys/labels stay in one place.
    permissions: ROUTE_PERMISSION_GROUPS.flatMap((g) =>
      g.keys.map((k) => ({ id: k.key as string, label: `${g.group} · ${k.label}` }))
    ),
  },
  {
    category: "Expenses",
    permissions: [
      { id: PERMISSIONS.EXPENSES.VIEW, label: "View Expenses" },
      { id: PERMISSIONS.EXPENSES.CREATE, label: "Create Expense" },
      { id: PERMISSIONS.EXPENSES.EDIT, label: "Edit Expense" },
      { id: PERMISSIONS.EXPENSES.DELETE, label: "Delete Expense" },
      { id: PERMISSIONS.EXPENSES.APPROVE, label: "Approve Expense" },
      { id: PERMISSIONS.EXPENSES.REJECT, label: "Reject Expense" },
      { id: PERMISSIONS.EXPENSES.EXPORT, label: "Export Expenses" },
    ]
  },
  {
    category: "Schemes & Pricing",
    permissions: [
      { id: PERMISSIONS.SCHEMES.VIEW, label: "View Schemes" },
      { id: PERMISSIONS.SCHEMES.CREATE, label: "Create Scheme" },
      { id: PERMISSIONS.SCHEMES.EDIT, label: "Edit Scheme" },
      { id: PERMISSIONS.SCHEMES.TOGGLE, label: "Activate / Deactivate Scheme" },
      { id: PERMISSIONS.SCHEMES.DELETE, label: "Delete Scheme" },
    ]
  },
  {
    category: "Visits",
    permissions: [
      { id: PERMISSIONS.VISITS.VIEW, label: "View Customer Visits" },
      { id: PERMISSIONS.MOBILE.VISIT_CHECKIN, label: "Check-in / Record Visit (Mobile)" },
      { id: PERMISSIONS.MOBILE.EDIT_GEOTAG, label: "Edit Visit / Customer Geo-tag" },
      { id: PERMISSIONS.VISITS.EXPORT, label: "Export Visits" },
    ]
  },
  {
    category: "Leave",
    permissions: [
      { id: PERMISSIONS.LEAVE.VIEW, label: "View Leaves" },
      { id: PERMISSIONS.LEAVE.MANAGE, label: "Apply / Manage Leave (on behalf)" },
      { id: PERMISSIONS.LEAVE.APPROVE, label: "Approve Leave" },
    ]
  },
  {
    // Merged from the old "Mobile App & Field Force" + "Location & Attendance" sections, which
    // overlapped on View Location Dashboard, Location Map Screen and Allow Mobile Logout. One home
    // for every location / attendance / mobile-device right. The view rights here gate BOTH the web
    // /location-tracking pages and the matching mobile Field Team screens.
    category: "Mobile App, Location & Attendance",
    note: "Location, attendance and mobile-device rights. View Location Dashboard / Live Feed / Tracking Health / Attendance gate the matching pages on BOTH web and the mobile Field Team module.",
    permissions: [
      { id: PERMISSIONS.MOBILE.VIEW_LOCATION_TRACKING, label: "View Location Dashboard" },
      { id: PERMISSIONS.FIELD.VIEW_LIVE_FEED, label: "View Live Feed / All Locations" },
      { id: PERMISSIONS.FIELD.VIEW_TRACKING_HEALTH, label: "View Tracking Health" },
      { id: PERMISSIONS.FIELD.VIEW_ATTENDANCE, label: "View Attendance" },
      { id: PERMISSIONS.FIELD.EXPORT_ATTENDANCE, label: "Export Attendance" },
      { id: PERMISSIONS.MOBILE.ALLOW_LOGOUT, label: "Allow Mobile Logout" },
    ]
  },
  {
    category: "Mobile Field Rules",
    note: "Enforced inside the mobile app. Leave a box UNticked to require the check (e.g. require a selfie). These take effect once the mobile app build reads them.",
    permissions: [
      { id: PERMISSIONS.FIELD_RULES.ORDER_WITHOUT_CHECKIN, label: "Allow Order without Visit Check-in" },
      { id: PERMISSIONS.FIELD_RULES.PAYMENT_WITHOUT_CHECKIN, label: "Allow Payment without Visit Check-in" },
      { id: PERMISSIONS.FIELD_RULES.VISIT_WITHOUT_PUNCHIN, label: "Allow Visit without Punch-in (Attendance)" },
      { id: PERMISSIONS.FIELD_RULES.PUNCH_SELFIE_REQUIRED, label: "Require Selfie on Punch In / Out" },
      { id: PERMISSIONS.FIELD_RULES.ODOMETER_PHOTO_REQUIRED, label: "Require Odometer Photo" },
    ]
  },
  {
    category: "Reports",
    permissions: [
      { id: PERMISSIONS.REPORTS.VIEW_SALES, label: "Sales & Order Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_PAYMENTS, label: "Payment Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_AGEING, label: "Ageing / Outstanding Reports" },
      // Lead & Deal reporting is a CRM-line right — hide it on SFA/WFA-only plans.
      { id: PERMISSIONS.REPORTS.VIEW_CRM, label: "Lead & Deal Reports", line: "crm" },
      { id: PERMISSIONS.REPORTS.VIEW_FIELD, label: "Visit / DSR Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_EXPENSE, label: "Expense Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_STOCK, label: "Stock Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_TASK, label: "Task Reports" },
      { id: PERMISSIONS.REPORTS.EXPORT, label: "Export any Report" },
      { id: PERMISSIONS.REPORTS.SHARE, label: "Share a Report as PDF" },
    ]
  },
  {
    category: "Masters — Sales",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.MASTERS.CREATE_PAYMENT_TYPES, label: "Create Payment Types" },
      { id: PERMISSIONS.MASTERS.EDIT_PAYMENT_TYPES, label: "Edit Payment Types" },
      { id: PERMISSIONS.MASTERS.DELETE_PAYMENT_TYPES, label: "Delete Payment Types" },
      { id: PERMISSIONS.MASTERS.CREATE_EXPENSE_TYPES, label: "Create Expense Types" },
      { id: PERMISSIONS.MASTERS.EDIT_EXPENSE_TYPES, label: "Edit Expense Types" },
      { id: PERMISSIONS.MASTERS.DELETE_EXPENSE_TYPES, label: "Delete Expense Types" },
      { id: PERMISSIONS.MASTERS.CREATE_TASK_TYPES, label: "Create Task / Activity Types" },
      { id: PERMISSIONS.MASTERS.EDIT_TASK_TYPES, label: "Edit Task / Activity Types" },
      { id: PERMISSIONS.MASTERS.DELETE_TASK_TYPES, label: "Delete Task / Activity Types" },
      { id: PERMISSIONS.MASTERS.CREATE_TAX_SLABS, label: "Create Tax Slabs" },
      { id: PERMISSIONS.MASTERS.EDIT_TAX_SLABS, label: "Edit Tax Slabs" },
      { id: PERMISSIONS.MASTERS.DELETE_TAX_SLABS, label: "Delete Tax Slabs" },
      { id: PERMISSIONS.MASTERS.CREATE_PRODUCT_UNITS, label: "Create Product Units" },
      { id: PERMISSIONS.MASTERS.EDIT_PRODUCT_UNITS, label: "Edit Product Units" },
      { id: PERMISSIONS.MASTERS.DELETE_PRODUCT_UNITS, label: "Delete Product Units" },
      { id: PERMISSIONS.MASTERS.CREATE_PRODUCT_CATEGORIES, label: "Create Product Categories" },
      { id: PERMISSIONS.MASTERS.EDIT_PRODUCT_CATEGORIES, label: "Edit Product Categories" },
      { id: PERMISSIONS.MASTERS.DELETE_PRODUCT_CATEGORIES, label: "Delete Product Categories" },
      { id: PERMISSIONS.MASTERS.CREATE_PRICE_LISTS, label: "Create Price Lists" },
      { id: PERMISSIONS.MASTERS.EDIT_PRICE_LISTS, label: "Edit Price Lists" },
      { id: PERMISSIONS.MASTERS.DELETE_PRICE_LISTS, label: "Delete Price Lists" },
    ]
  },
  {
    category: "Masters — Leads & Deals",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.MASTERS.CREATE_LEAD_SOURCES, label: "Create Lead Sources" },
      { id: PERMISSIONS.MASTERS.EDIT_LEAD_SOURCES, label: "Edit Lead Sources" },
      { id: PERMISSIONS.MASTERS.DELETE_LEAD_SOURCES, label: "Delete Lead Sources" },
      { id: PERMISSIONS.MASTERS.CREATE_LEAD_STATUSES, label: "Create Lead Statuses" },
      { id: PERMISSIONS.MASTERS.EDIT_LEAD_STATUSES, label: "Edit Lead Statuses" },
      { id: PERMISSIONS.MASTERS.DELETE_LEAD_STATUSES, label: "Delete Lead Statuses" },
      { id: PERMISSIONS.MASTERS.CREATE_LEAD_INDUSTRIES, label: "Create Lead Industries" },
      { id: PERMISSIONS.MASTERS.EDIT_LEAD_INDUSTRIES, label: "Edit Lead Industries" },
      { id: PERMISSIONS.MASTERS.DELETE_LEAD_INDUSTRIES, label: "Delete Lead Industries" },
      { id: PERMISSIONS.MASTERS.CREATE_PIPELINES, label: "Create Deal Pipelines & Stages" },
      { id: PERMISSIONS.MASTERS.EDIT_PIPELINES, label: "Edit Deal Pipelines & Stages" },
      { id: PERMISSIONS.MASTERS.DELETE_PIPELINES, label: "Delete Deal Pipelines & Stages" },
    ]
  },
  {
    category: "Masters — Geography & Field",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.MASTERS.CREATE_TERRITORIES, label: "Create Territories" },
      { id: PERMISSIONS.MASTERS.EDIT_TERRITORIES, label: "Edit Territories" },
      { id: PERMISSIONS.MASTERS.DELETE_TERRITORIES, label: "Delete Territories" },
      { id: PERMISSIONS.MASTERS.CREATE_GEOFENCES, label: "Create Geofences" },
      { id: PERMISSIONS.MASTERS.EDIT_GEOFENCES, label: "Edit Geofences" },
      { id: PERMISSIONS.MASTERS.DELETE_GEOFENCES, label: "Delete Geofences" },
    ]
  },
  {
    category: "Masters — HR",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.MASTERS.CREATE_LEAVE_TYPES, label: "Create Leave Types" },
      { id: PERMISSIONS.MASTERS.EDIT_LEAVE_TYPES, label: "Edit Leave Types" },
      { id: PERMISSIONS.MASTERS.DELETE_LEAVE_TYPES, label: "Delete Leave Types" },
      { id: PERMISSIONS.MASTERS.CREATE_HOLIDAYS, label: "Create Holidays" },
      { id: PERMISSIONS.MASTERS.EDIT_HOLIDAYS, label: "Edit Holidays" },
      { id: PERMISSIONS.MASTERS.DELETE_HOLIDAYS, label: "Delete Holidays" },
    ]
  },
  {
    category: "Masters — Workspace",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.MASTERS.CREATE_DOCUMENT_TEMPLATES, label: "Create Templates" },
      { id: PERMISSIONS.MASTERS.EDIT_DOCUMENT_TEMPLATES, label: "Edit Templates" },
      { id: PERMISSIONS.MASTERS.DELETE_DOCUMENT_TEMPLATES, label: "Delete Templates" },
      { id: PERMISSIONS.MASTERS.CREATE_CUSTOM_FIELDS, label: "Create Custom Fields" },
      { id: PERMISSIONS.MASTERS.EDIT_CUSTOM_FIELDS, label: "Edit Custom Fields" },
      { id: PERMISSIONS.MASTERS.DELETE_CUSTOM_FIELDS, label: "Delete Custom Fields" },
      { id: PERMISSIONS.MASTERS.CREATE_QUOTATION_TERMS, label: "Create Quotation Terms" },
      { id: PERMISSIONS.MASTERS.EDIT_QUOTATION_TERMS, label: "Edit Quotation Terms" },
      { id: PERMISSIONS.MASTERS.DELETE_QUOTATION_TERMS, label: "Delete Quotation Terms" },
    ]
  },
  {
    category: "Settings",
    note: WEB_ONLY_NOTE,
    permissions: [
      { id: PERMISSIONS.SETTINGS.MANAGE_ORG, label: "Manage Organization Settings (module toggles, working days)" },
      { id: PERMISSIONS.SETTINGS.MANAGE_ORDER_SETTINGS, label: "Manage Order Settings" },
      { id: PERMISSIONS.SETTINGS.MANAGE_ROUTE_SETTINGS, label: "Manage Route Settings" },
      { id: PERMISSIONS.SETTINGS.MANAGE_COMPANY_PROFILE, label: "Manage Company Profile" },
      { id: PERMISSIONS.SETTINGS.MANAGE_API_KEYS, label: "Manage API Keys & Webhooks" },
      { id: PERMISSIONS.SETTINGS.MANAGE_WHATSAPP_SETTINGS, label: "Manage WhatsApp Settings" },
      { id: PERMISSIONS.SETTINGS.MANAGE_TAGS, label: "Manage Tags" },
      { id: PERMISSIONS.ADMIN.BILLING, label: "Manage Subscription & Billing" },
    ]
  },
  {
    category: "Login Access",
    note: "Controls sign-in per surface. Web Access → can log into the web portal. Mobile Access → can log into the Android app. Missing one blocks that surface.",
    permissions: [
      { id: PERMISSIONS.ACCESS.WEB, label: "Web Portal Access" },
      { id: PERMISSIONS.ACCESS.MOBILE, label: "Mobile App Access" },
    ]
  },
  {
    category: "Data Visibility",
    note: "By default a user sees only their OWN records (Leads, Customers, Orders, etc.). These widen that through the reporting hierarchy. Owner/Admin always see everything.",
    permissions: [
      { id: PERMISSIONS.DATA_ACCESS.VIEW_CHILD_DATA, label: "View Subordinate (Child) Data — everyone reporting under this user" },
      { id: PERMISSIONS.DATA_ACCESS.VIEW_PARENT_DATA, label: "View Manager (Parent) Data — this user's reporting chain upward" },
    ]
  },
  {
    category: "Team & Roles",
    danger: true,
    note: `DANGER: a role that can manage roles can grant itself ANY permission. Give this only to trusted admins. ${WEB_ONLY_NOTE}`,
    permissions: [
      { id: PERMISSIONS.ADMIN.VIEW_TEAM_MANAGEMENT, label: "View Team / Employees" },
      { id: PERMISSIONS.TEAM.MANAGE_EMPLOYEES, label: "Create / Edit / Deactivate Employees" },
      { id: PERMISSIONS.TEAM.MANAGE_ROLES, label: "Create / Edit Roles & Permissions" },
      { id: PERMISSIONS.TEAM.APPROVE_DEVICES, label: "Approve Mobile Devices" },
    ]
  }
];

/**
 * Flat index of every right (category + label) for the command palette.
 * Selecting one deep-links to `/team/roles?find=<label>`.
 */
export const PERMISSION_INDEX: { category: string; label: string }[] =
  PERMISSION_GROUPS.flatMap((g) =>
    g.permissions.map((p) => ({ category: g.category, label: p.label })),
  );

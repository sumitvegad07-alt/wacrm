/**
 * Central Permission Registry
 *
 * Source of truth for all permission strings used throughout the application.
 * Use these constants in `hasPermission()` instead of hardcoded strings.
 *
 * Module-wise RBAC v2 (2026-08-23): every module + master exposes its own rights.
 * The original groups (CRM, CATALOGUE, …) are kept verbatim for backward-compat;
 * new module/master/settings groups are appended below. Keys are resolved by
 * has_permission() (owner/admin bypass, {"all":true} bypass, add_/create_ alias,
 * prefix_* wildcard).
 *
 * NOTE — MOBILE-ENFORCED KEYS (FIELD_RULES + ACCESS.MOBILE): these gate behavior
 * inside the React Native app. The web app stores/renders them; the mobile build
 * must read them to actually enforce on-device.
 */
export const PERMISSIONS = {
  // CRM & Sales
  CRM: {
    VIEW_DASHBOARD: 'view_dashboard',
    VIEW_LEADS: 'view_leads',
    CREATE_LEADS: 'create_leads',
    EDIT_LEADS: 'edit_leads',
    DELETE_LEADS: 'delete_leads',
    CONVERT_LEADS: 'convert_leads',
    ASSIGN_LEADS: 'assign_leads',
    IMPORT_LEADS: 'import_leads',
    EXPORT_LEADS: 'export_leads',
    VIEW_CONTACTS: 'view_contacts',
    CREATE_CONTACTS: 'create_contacts',
    EDIT_CONTACTS: 'edit_contacts',
    DELETE_CONTACTS: 'delete_contacts',
    IMPORT_CONTACTS: 'import_contacts',
    EXPORT_CONTACTS: 'export_contacts',
    VIEW_DEALS: 'view_deals',
    VIEW_ORDERS: 'view_orders',
    CREATE_ORDERS: 'create_orders',
    EDIT_ORDERS: 'edit_orders',
    DELETE_ORDERS: 'delete_orders',
    MANAGE_ORDER_STATUS: 'manage_order_status',
    APPLY_ORDER_DISCOUNT: 'apply_order_discount',
    OVERRIDE_ORDER_PRICE: 'override_order_price',
    EDIT_ORDER_TAX: 'edit_order_tax',
    IMPORT_ORDERS: 'import_orders',
    EXPORT_ORDERS: 'export_orders',
    SHARE_ORDERS: 'share_orders',              // share the order (PDF / link)
  },

  // Deals / Pipeline (separate module)
  DEALS: {
    VIEW: 'view_deals',
    CREATE: 'create_deals',
    EDIT: 'edit_deals',
    DELETE: 'delete_deals',
    MOVE_STAGE: 'move_deal_stage',
    CONVERT_TO_QUOTATION: 'convert_deal_to_quotation',
    EXPORT: 'export_deals',
  },

  // Catalogue (Products, Units, Categories)
  CATALOGUE: {
    VIEW_PRODUCTS: 'view_products',
    CREATE_PRODUCTS: 'create_products',
    EDIT_PRODUCTS: 'edit_products',
    DELETE_PRODUCTS: 'delete_products',
    IMPORT_PRODUCTS: 'import_products',
    EXPORT_PRODUCTS: 'export_products',
    MANAGE_UNITS: 'manage_product_units',
    MANAGE_CATEGORIES: 'manage_product_categories',
  },

  // Quotations
  QUOTATIONS: {
    VIEW: 'view_quotations',
    CREATE: 'create_quotations',
    EDIT: 'edit_quotations',
    DELETE: 'delete_quotations',
    PRINT: 'print_quotations',
    SHARE: 'share_quotations',
  },

  // Dispatch (for a dispatch executive)
  DISPATCH: {
    VIEW: 'view_dispatch',
    CREATE: 'create_dispatch',
    EDIT: 'edit_dispatch',
    DELETE: 'delete_dispatch',
    IMPORT: 'import_dispatch',
    EXPORT: 'export_dispatch',
    SHARE: 'share_dispatch',                    // share dispatch details (future)
    TRANSPORT_COMPULSORY: 'transport_compulsory', // field rule: require transport details
  },

  // Expenses
  EXPENSES: {
    VIEW: 'view_expenses',
    CREATE: 'create_expenses',
    EDIT: 'edit_expenses',
    DELETE: 'delete_expenses',
    APPROVE: 'approve_expenses',
    REJECT: 'reject_expenses',
    EXPORT: 'export_expenses',
  },

  // Stock / Inventory
  STOCK: {
    VIEW: 'view_stock',
    MANAGE: 'manage_stock',
    IMPORT: 'import_stock',
  },

  // Schemes
  SCHEMES: {
    VIEW: 'view_schemes',
    CREATE: 'create_schemes',
    EDIT: 'edit_schemes',
    DELETE: 'delete_schemes',
    // Activate / deactivate a scheme (the on/off toggle). Separate from EDIT so a
    // role can be allowed to flip a scheme live/paused without full edit rights —
    // and, conversely, an editor can be denied the toggle. Enforced on mobile.
    TOGGLE: 'toggle_schemes',
  },

  // Payments & Finance
  PAYMENTS: {
    VIEW: 'view_payments',
    CREATE: 'create_payments',
    EDIT: 'edit_payments',
    CANCEL: 'cancel_payments',
    APPROVE: 'approve_payments',
    REJECT: 'reject_payments',
    VIEW_ATTACHMENTS: 'view_payment_attachments',
    VIEW_REPORTS: 'view_payment_reports',
    EXPORT_REPORTS: 'export_payment_reports',
    BACKDATE: 'backdate_payments',
  },

  // Customer Financials
  CUSTOMERS: {
    VIEW_OUTSTANDING: 'view_customer_outstanding',
    VIEW_FINANCIALS: 'view_customer_financials',
    VIEW_CUSTOMER_CREDIT_LIMIT: 'view_customer_credit_limit',
    VIEW_CUSTOMER_PAYMENT_HISTORY: 'view_customer_payment_history',
    MANAGE_CREDIT: 'manage_customer_credit',
    VIEW_OPENING_BALANCE: 'view_opening_balance',
    EDIT_OPENING_BALANCE: 'edit_opening_balance',
  },

  // Credit Control — removed 2026-08-30: `override_credit_limit` was a dormant per-role right.
  // Credit control is enforced on the order form by the account setting `creditLimitAction`
  // (ignore / warn / block), which applies org-wide; the per-role override was never wired in.

  // Data Visibility — directional scoping through the reporting hierarchy (profiles.manager_id).
  // Default (neither right) = a user sees only their OWN records. These widen that; owner/admin
  // and any {all:true} role see everything regardless. Replaced the old own/team `global_scope`
  // selector. Enforced app-level first (mobile), RLS hardening to follow.
  DATA_ACCESS: {
    VIEW_CHILD_DATA: 'view_child_data',   // also see subordinates' (downline) records
    VIEW_PARENT_DATA: 'view_parent_data', // also see managers' (upline) records
  },

  // Task Management
  TASKS: {
    VIEW: 'view_tasks',
    CREATE: 'create_task',
    EDIT: 'edit_task',
    DELETE: 'delete_task',
    ASSIGN_PARENT: 'assign_tasks_parent',
    ASSIGN_CHILD: 'assign_tasks_child',
    ASSIGN_ALL: 'assign_tasks_all',
  },

  // Leave
  LEAVE: {
    VIEW: 'view_leaves',
    MANAGE: 'manage_leaves',
    APPROVE: 'approve_leaves',
  },

  // Visits
  VISITS: {
    VIEW: 'view_visits',
    EXPORT: 'export_visits',
  },

  // Mobile App & Field Force (existing keys)
  MOBILE: {
    VIEW_LOCATION_TRACKING: 'view_location_tracking',
    ALLOW_LOGOUT: 'allow_logout',
    OFFLINE_MODE: 'mobile_offline_mode',
    VISIT_CHECKIN: 'mobile_visit_checkin',
    EDIT_GEOTAG: 'edit_geotag',
    // Removed 2026-08-30: LOCATION_SCREEN ('mobile_location_screen') — the mobile location
    // screen now exists (Field Team → Live Feed) gated by view_location_tracking / view_live_feed,
    // so this key was a redundant placeholder gating nothing.
  },

  // Location / Attendance (new field rights)
  FIELD: {
    VIEW_LIVE_FEED: 'view_live_feed',
    VIEW_TRACKING_HEALTH: 'view_tracking_health',
    VIEW_ATTENDANCE: 'view_attendance',
    EXPORT_ATTENDANCE: 'export_attendance',
    // Removed 2026-08-30: MANAGE_ATTENDANCE ('manage_attendance') — gated nothing on web or
    // mobile (no attendance-regularization feature exists). Re-add when that feature is built.
  },

  // Mobile field RULES — enforced INSIDE the mobile app (web stores + renders).
  FIELD_RULES: {
    ORDER_WITHOUT_CHECKIN: 'order_without_checkin',
    PAYMENT_WITHOUT_CHECKIN: 'payment_without_checkin',
    VISIT_WITHOUT_PUNCHIN: 'visit_without_punchin',
    PUNCH_SELFIE_REQUIRED: 'punch_selfie_required',
    ODOMETER_PHOTO_REQUIRED: 'odometer_photo_required',
  },

  // Routes / Beat
  ROUTES: {
    VIEW: 'view_routes',
    CREATE: 'create_routes',
    EDIT: 'edit_routes',
    DELETE: 'delete_routes',
    ASSIGN: 'assign_routes',
    EXECUTE: 'execute_route',
    APPROVE: 'approve_routes',
    MANAGE_CUSTOMERS: 'manage_route_customers',
    MANAGE_SCHEDULE: 'manage_route_schedule',
  },

  // WhatsApp Features
  WHATSAPP: {
    VIEW: 'view_whatsapp',
    SEND: 'send_whatsapp',
    VIEW_BROADCASTS: 'view_whatsapp_broadcasts',
    VIEW_AUTOMATIONS: 'view_whatsapp_automations',
    VIEW_FLOWS: 'view_whatsapp_flows',
    VIEW_TEMPLATES: 'view_whatsapp_templates',
    VIEW_AI_ASSISTANT: 'view_ai_assistant',
  },

  // Reports (per family) + export
  REPORTS: {
    VIEW_SALES: 'view_sales_reports',
    VIEW_PAYMENTS: 'view_payment_reports',
    VIEW_AGEING: 'view_ageing_reports',
    VIEW_CRM: 'view_crm_reports',
    VIEW_FIELD: 'view_field_reports',
    VIEW_EXPENSE: 'view_expense_reports',
    VIEW_STOCK: 'view_stock_reports',
    VIEW_TASK: 'view_task_reports',
    EXPORT: 'export_reports',
    SHARE: 'share_reports',                     // share a report as a PDF (mobile-enforced too)
  },

  // Masters — create/edit/delete each (founder request).
  MASTERS: {
    CREATE_PAYMENT_TYPES: 'create_payment_types', EDIT_PAYMENT_TYPES: 'edit_payment_types', DELETE_PAYMENT_TYPES: 'delete_payment_types',
    CREATE_EXPENSE_TYPES: 'create_expense_types', EDIT_EXPENSE_TYPES: 'edit_expense_types', DELETE_EXPENSE_TYPES: 'delete_expense_types',
    CREATE_TASK_TYPES: 'create_task_types', EDIT_TASK_TYPES: 'edit_task_types', DELETE_TASK_TYPES: 'delete_task_types',
    CREATE_TAX_SLABS: 'create_tax_slabs', EDIT_TAX_SLABS: 'edit_tax_slabs', DELETE_TAX_SLABS: 'delete_tax_slabs',
    CREATE_PRODUCT_UNITS: 'create_product_units', EDIT_PRODUCT_UNITS: 'edit_product_units', DELETE_PRODUCT_UNITS: 'delete_product_units',
    CREATE_PRODUCT_CATEGORIES: 'create_product_categories', EDIT_PRODUCT_CATEGORIES: 'edit_product_categories', DELETE_PRODUCT_CATEGORIES: 'delete_product_categories',
    CREATE_PRICE_LISTS: 'create_price_lists', EDIT_PRICE_LISTS: 'edit_price_lists', DELETE_PRICE_LISTS: 'delete_price_lists',
    CREATE_LEAD_SOURCES: 'create_lead_sources', EDIT_LEAD_SOURCES: 'edit_lead_sources', DELETE_LEAD_SOURCES: 'delete_lead_sources',
    CREATE_LEAD_STATUSES: 'create_lead_statuses', EDIT_LEAD_STATUSES: 'edit_lead_statuses', DELETE_LEAD_STATUSES: 'delete_lead_statuses',
    CREATE_LEAD_INDUSTRIES: 'create_lead_industries', EDIT_LEAD_INDUSTRIES: 'edit_lead_industries', DELETE_LEAD_INDUSTRIES: 'delete_lead_industries',
    CREATE_PIPELINES: 'create_pipelines', EDIT_PIPELINES: 'edit_pipelines', DELETE_PIPELINES: 'delete_pipelines',
    CREATE_TERRITORIES: 'create_territories', EDIT_TERRITORIES: 'edit_territories', DELETE_TERRITORIES: 'delete_territories',
    CREATE_GEOFENCES: 'create_geofences', EDIT_GEOFENCES: 'edit_geofences', DELETE_GEOFENCES: 'delete_geofences',
    CREATE_LEAVE_TYPES: 'create_leave_types', EDIT_LEAVE_TYPES: 'edit_leave_types', DELETE_LEAVE_TYPES: 'delete_leave_types',
    CREATE_HOLIDAYS: 'create_holidays', EDIT_HOLIDAYS: 'edit_holidays', DELETE_HOLIDAYS: 'delete_holidays',
    CREATE_DOCUMENT_TEMPLATES: 'create_document_templates', EDIT_DOCUMENT_TEMPLATES: 'edit_document_templates', DELETE_DOCUMENT_TEMPLATES: 'delete_document_templates',
    CREATE_CUSTOM_FIELDS: 'create_custom_fields', EDIT_CUSTOM_FIELDS: 'edit_custom_fields', DELETE_CUSTOM_FIELDS: 'delete_custom_fields',
    CREATE_QUOTATION_TERMS: 'create_quotation_terms', EDIT_QUOTATION_TERMS: 'edit_quotation_terms', DELETE_QUOTATION_TERMS: 'delete_quotation_terms',
  },

  // Settings (per-panel, decision #5)
  SETTINGS: {
    MANAGE_ORG: 'manage_org_settings',
    MANAGE_ORDER_SETTINGS: 'manage_order_settings',
    MANAGE_ROUTE_SETTINGS: 'manage_route_settings',
    MANAGE_COMPANY_PROFILE: 'manage_company_profile',
    MANAGE_API_KEYS: 'manage_api_keys',
    MANAGE_WHATSAPP_SETTINGS: 'manage_whatsapp_settings',
    MANAGE_TAGS: 'manage_tags',
  },

  // Team & Admin — SENSITIVE. manage_roles is escalation-capable.
  TEAM: {
    MANAGE_EMPLOYEES: 'manage_employees',
    MANAGE_ROLES: 'manage_roles',
    APPROVE_DEVICES: 'approve_devices',
  },

  // Login surface access (gates sign-in per surface).
  ACCESS: {
    WEB: 'web_access',
    MOBILE: 'mobile_access',
  },

  // Administration (existing)
  ADMIN: {
    VIEW_TEAM_MANAGEMENT: 'view_team_management',
    BILLING: 'billing',
    SETTINGS_GENERAL: 'settings_general',
  },

  // Data Import (Universal Import Framework)
  IMPORT: {
    DATA: 'import_data',
    MANAGE: 'import_manage',
  },

  // ASK OZZO — Support & Implementation Copilot (read-only assistant).
  // Default-granted; owner/admin resolve as all-true via has_permission().
  // Gating is soft (it's help, not a privileged action); an org can also
  // switch the whole feature off via accounts.settings.ask_ozzo_enabled.
  ASSISTANT: {
    USE_ASK_OZZO: 'use_ask_ozzo',
  },
} as const;

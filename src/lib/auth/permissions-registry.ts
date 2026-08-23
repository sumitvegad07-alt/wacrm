/**
 * Central Permission Registry
 *
 * Source of truth for all permission strings used throughout the application.
 * Use these constants in `hasPermission()` instead of hardcoded strings.
 */
export const PERMISSIONS = {
  // CRM & Sales
  CRM: {
    VIEW_DASHBOARD: 'view_dashboard',
    VIEW_LEADS: 'view_leads',
    CREATE_LEADS: 'create_leads',
    EDIT_LEADS: 'edit_leads',
    DELETE_LEADS: 'delete_leads',
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
    // Override a product's unit price on an order line (distinct from a discount).
    OVERRIDE_ORDER_PRICE: 'override_order_price',
    EXPORT_ORDERS: 'export_orders',
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

  // Dispatch (for a dispatch executive)
  DISPATCH: {
    VIEW: 'view_dispatch',
    CREATE: 'create_dispatch',
    EDIT: 'edit_dispatch',
    DELETE: 'delete_dispatch',
  },

  // Stock / Inventory
  STOCK: {
    VIEW: 'view_stock',
    MANAGE: 'manage_stock', // set opening stock + create Stock In/Out adjustments; implies VIEW
    IMPORT: 'import_stock',
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
    // Recording a collection dated further back than the account's
    // `allow_backdate_days` window. Withheld from field reps by default: a
    // backdated collection can make an overdue account look settled.
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

  // Credit Control
  CREDIT_CONTROL: {
    OVERRIDE_CREDIT_LIMIT: 'override_credit_limit',
  },

  // Task Management
  TASKS: {
    VIEW: 'view_tasks',
    CREATE: 'create_task', // Kept as create_task since it was already create_task
    EDIT: 'edit_task',
    DELETE: 'delete_task',
    ASSIGN_PARENT: 'assign_tasks_parent',
    ASSIGN_CHILD: 'assign_tasks_child',
    ASSIGN_ALL: 'assign_tasks_all',
  },

  // Mobile App & Field Force
  MOBILE: {
    VIEW_LOCATION_TRACKING: 'view_location_tracking',
    LOCATION_SCREEN: 'mobile_location_screen',
    ALLOW_LOGOUT: 'allow_logout',
    OFFLINE_MODE: 'mobile_offline_mode',
    VISIT_CHECKIN: 'mobile_visit_checkin',
    EDIT_GEOTAG: 'edit_geotag',
  },

  // WhatsApp Features
  WHATSAPP: {
    VIEW: 'view_whatsapp',
    VIEW_BROADCASTS: 'view_whatsapp_broadcasts',
    VIEW_AUTOMATIONS: 'view_whatsapp_automations',
    VIEW_FLOWS: 'view_whatsapp_flows',
    VIEW_TEMPLATES: 'view_whatsapp_templates',
    VIEW_AI_ASSISTANT: 'view_ai_assistant',
  },

  // Administration
  ADMIN: {
    VIEW_TEAM_MANAGEMENT: 'view_team_management',
    BILLING: 'billing',
    SETTINGS_GENERAL: 'settings_general',
  },

  // Data Import (Universal Import Framework)
  IMPORT: {
    // Baseline capability: can open the Import wizard and commit rows into a
    // module (combined with that module's own create/manage permission + RLS).
    DATA: 'import_data',
    // Elevated: manage mapping templates, auto-create unknown master values
    // during a guided-resolve, and undo an import. Admin-level.
    MANAGE: 'import_manage',
  },
} as const;

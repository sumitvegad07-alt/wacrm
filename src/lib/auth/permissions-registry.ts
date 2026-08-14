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
    VIEW_DEALS: 'view_deals',
    VIEW_PRODUCTS: 'view_products',
    VIEW_ORDERS: 'view_orders',
    CREATE_ORDERS: 'create_orders',
    EDIT_ORDERS: 'edit_orders',
    MANAGE_ORDER_STATUS: 'manage_order_status',
    APPLY_ORDER_DISCOUNT: 'apply_order_discount',
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
  }
} as const;

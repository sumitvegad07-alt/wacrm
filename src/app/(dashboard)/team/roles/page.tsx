"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Shield, Plus, AlertCircle, Save, Trash2, Edit2, Users, Check, Minus, Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import type { RolePermissions, DataScope } from "@/lib/auth/rbac";
import { ROUTE_PERMISSION_GROUPS } from "@/lib/route/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";

interface EmployeeRole {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  permissions: RolePermissions;
  created_at: string;
}

type PermGroup = {
  category: string;
  permissions: { id: string; label: string }[];
  danger?: boolean;
  note?: string;
};

const PERMISSION_GROUPS: PermGroup[] = [
  {
    category: "Leads",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_DASHBOARD, label: "View Main Dashboard" },
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
      { id: PERMISSIONS.CRM.MANAGE_APPROVAL_PROCESS, label: "Change / Reset Approval Process" },
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
    permissions: [
      { id: PERMISSIONS.STOCK.VIEW, label: "View Stock (closing stock, ledger, report)" },
      { id: PERMISSIONS.STOCK.MANAGE, label: "Manage Stock (set opening, Stock In / Out adjustments)" },
      { id: PERMISSIONS.STOCK.IMPORT, label: "Import Opening Stock" },
    ]
  },
  {
    category: "Data Import",
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
    category: "Credit Control",
    permissions: [
      { id: PERMISSIONS.CREDIT_CONTROL.OVERRIDE_CREDIT_LIMIT, label: "Override Credit Limit on Orders" },
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
    category: "Mobile App & Field Force",
    permissions: [
      { id: PERMISSIONS.MOBILE.VIEW_LOCATION_TRACKING, label: "View Location Dashboard (Web)" },
      { id: PERMISSIONS.MOBILE.LOCATION_SCREEN, label: "Location Map Screen (Mobile)" },
      { id: PERMISSIONS.MOBILE.ALLOW_LOGOUT, label: "Allow Mobile Logout" },
      { id: PERMISSIONS.MOBILE.VISIT_CHECKIN, label: "Allow Manual Check-ins" },
      { id: PERMISSIONS.MOBILE.EDIT_GEOTAG, label: "Edit Customer Geo-tag (Coordinates)" },
    ]
  },
  {
    category: "WhatsApp Features",
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
    category: "Location & Attendance",
    permissions: [
      { id: PERMISSIONS.MOBILE.VIEW_LOCATION_TRACKING, label: "View Location Dashboard (Web)" },
      { id: PERMISSIONS.FIELD.VIEW_LIVE_FEED, label: "View Live Feed / All Locations" },
      { id: PERMISSIONS.FIELD.VIEW_TRACKING_HEALTH, label: "View Tracking Health" },
      { id: PERMISSIONS.FIELD.VIEW_ATTENDANCE, label: "View Attendance" },
      { id: PERMISSIONS.FIELD.MANAGE_ATTENDANCE, label: "Edit / Regularize Attendance" },
      { id: PERMISSIONS.FIELD.EXPORT_ATTENDANCE, label: "Export Attendance" },
      { id: PERMISSIONS.MOBILE.LOCATION_SCREEN, label: "Location Map Screen (Mobile)" },
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
      { id: PERMISSIONS.REPORTS.VIEW_CRM, label: "Lead & Deal Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_FIELD, label: "Visit / DSR Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_EXPENSE, label: "Expense Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_STOCK, label: "Stock Reports" },
      { id: PERMISSIONS.REPORTS.VIEW_TASK, label: "Task Reports" },
      { id: PERMISSIONS.REPORTS.EXPORT, label: "Export any Report" },
    ]
  },
  {
    category: "Masters — Sales",
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
    category: "Team & Roles",
    danger: true,
    note: "DANGER: a role that can manage roles can grant itself ANY permission. Give this only to trusted admins.",
    permissions: [
      { id: PERMISSIONS.ADMIN.VIEW_TEAM_MANAGEMENT, label: "View Team / Employees" },
      { id: PERMISSIONS.TEAM.MANAGE_EMPLOYEES, label: "Create / Edit / Deactivate Employees" },
      { id: PERMISSIONS.TEAM.MANAGE_ROLES, label: "Create / Edit Roles & Permissions" },
      { id: PERMISSIONS.TEAM.APPROVE_DEVICES, label: "Approve Mobile Devices" },
    ]
  }
];

const DATA_SCOPES: { value: DataScope; label: string }[] = [
  { value: "own", label: "Own Records Only" },
  { value: "team", label: "Own & Team Records" },
];

// Maps each rights section to the plan line that unlocks it. Groups not listed
// here are base features shown on every plan. A group is only shown if the
// account's purchased plan includes its line (CRM / SFA / WFA).
const GROUP_LINE: Record<string, "crm" | "sfa" | "wfa"> = {
  "Leads": "crm",
  "Deals / Pipeline": "crm",
  "WhatsApp Features": "crm",
  "Catalogue (Products)": "sfa",
  "Quotations": "sfa",
  "Orders": "sfa",
  "Dispatch": "sfa",
  "Payments & Finance": "sfa",
  "Customer Financials": "sfa",
  "Credit Control": "sfa",
  "Expenses": "sfa",
  "Stock / Inventory": "sfa",
  "Schemes & Pricing": "sfa",
  "Visits": "wfa",
  "Leave": "wfa",
  "Location & Attendance": "wfa",
  "Mobile App & Field Force": "wfa",
  "Mobile Field Rules": "wfa",
  "Route Management": "wfa",
};

export default function RolesPage() {
  const { accountId, isSuperadmin, hasPermission, hasCRM, hasSFA, hasWFA } = useAuth();

  // Rights sections visible for this account's plan, with Login Access pinned first.
  const visibleGroups = useMemo(() => {
    const lineOk = (cat: string) => {
      const line = GROUP_LINE[cat];
      if (!line) return true; // base feature — always shown
      if (line === "crm") return hasCRM;
      if (line === "sfa") return hasSFA;
      if (line === "wfa") return hasWFA;
      return true;
    };
    const shown = PERMISSION_GROUPS.filter((g) => lineOk(g.category));
    const top = shown.filter((g) => g.category === "Login Access");
    const rest = shown.filter((g) => g.category !== "Login Access");
    return [...top, ...rest];
  }, [hasCRM, hasSFA, hasWFA]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<EmployeeRole | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<RolePermissions>({});

  const supabase = createClient();

  useEffect(() => {
    if (accountId) {
      fetchRoles();
    }
  }, [accountId]);

  const fetchRoles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employee_roles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      toast.error("Failed to load roles");
    } else {
      setRoles(data || []);
      if (!selectedRole && data && data.length > 0) {
        handleSelectRole(data[0]);
      }
    }
    setLoading(false);
  };

  const handleSelectRole = (role: EmployeeRole) => {
    setSelectedRole(role);
    setName(role.name);
    setDescription(role.description || "");
    setPermissions(role.permissions || {});
    setIsEditing(false);
  };

  const handleNewRole = () => {
    setSelectedRole(null);
    setName("");
    setDescription("");
    setPermissions({});
    setIsEditing(true);
  };

  // Clone the selected role: start a NEW role pre-filled with the same rights,
  // so an admin can duplicate a role and tweak a few checkboxes.
  const handleCloneRole = () => {
    if (!selectedRole) return;
    setSelectedRole(null); // null => Save inserts a new role
    setName(`Copy of ${selectedRole.name}`);
    setDescription(selectedRole.description || "");
    setPermissions({ ...(selectedRole.permissions || {}) });
    setIsEditing(true);
    toast.info("Cloned role — rename and adjust rights, then Save.");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Role name is required");
      return;
    }

    const payload = {
      account_id: accountId,
      name,
      description,
      permissions,
      status: "active",
    };

    if (selectedRole) {
      // Update
      const { error } = await supabase
        .from("employee_roles")
        .update(payload)
        .eq("id", selectedRole.id);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Role updated successfully");
        fetchRoles();
        setIsEditing(false);
      }
    } else {
      // Insert
      const { data, error } = await supabase
        .from("employee_roles")
        .insert(payload)
        .select()
        .single();

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Role created successfully");
        fetchRoles();
        if (data) handleSelectRole(data as EmployeeRole);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this role?")) return;
    
    const { error } = await supabase.from("employee_roles").delete().eq("id", id);
    if (error) {
      toast.error("Cannot delete role. It may be assigned to employees.");
    } else {
      toast.success("Role deleted");
      setSelectedRole(null);
      setIsEditing(false);
      fetchRoles();
    }
  };

  const togglePermission = (key: string, checked: boolean) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: checked
    }));
  };

  // Apply All / Clear All for a whole module group.
  const toggleGroupAll = (group: PermGroup, checked: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev };
      for (const p of group.permissions) next[p.id] = checked;
      return next;
    });
  };

  // Global "Select all" across every visible (plan-allowed) rights section.
  const toggleAllVisible = (checked: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) for (const p of g.permissions) next[p.id] = checked;
      return next;
    });
  };
  const allVisibleOn = visibleGroups.length > 0 && visibleGroups.every((g) => g.permissions.every((p) => !!permissions[p.id]));

  if (!hasPermission("view_team_management") && !isSuperadmin) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>You do not have permission to view this page.</AlertDescription>
        </Alert>
      </div>
    );
  }

  // All employee roles are fully configurable (rename, edit rights, delete).
  // Security comes from account_role (derived from a role's Full Access flag),
  // not from a role's name, so nothing needs to be hard-locked.
  const isAdminRole = false;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
      {/* Top bar: horizontal role selector (replaces the old left column, so the
          rights screen below gets the full width). */}
      <div className="border-b bg-card px-4 py-2.5 flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="font-semibold flex items-center gap-2 text-foreground shrink-0">
          <Shield className="w-4 h-4 text-muted-foreground" />
          Employee Roles
        </h2>
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => handleSelectRole(role)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedRole?.id === role.id && !isEditing
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border hover:bg-muted text-foreground"
                }`}
              >
                {role.name}
                {role.permissions?.all && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">Admin</span>
                )}
              </button>
            ))
          )}
        </div>
        <Button size="sm" onClick={handleNewRole} variant="outline" className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New Role
        </Button>
      </div>

      {/* Content — full width */}
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
          {(!selectedRole && !isEditing) ? (
            <div className="flex-1 flex flex-col p-8 overflow-y-auto bg-muted/10">
              <div className="flex items-center gap-3 mb-6">
                <Shield className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold">Permission Audit Report</h2>
              </div>
              <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-xs font-semibold">
                    <tr>
                      <th className="px-6 py-4">Role Name</th>
                      <th className="px-6 py-4 text-center">Permissions Count</th>
                      <th className="px-6 py-4">Last Modified On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {roles.map(role => {
                      const count = role.permissions?.all ? 'All (Admin)' : Object.keys(role.permissions || {}).length;
                      return (
                        <tr key={role.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4 font-medium">{role.name}</td>
                          <td className="px-6 py-4 text-center">
                            <Badge variant="outline" className="font-mono">{count}</Badge>
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">
                            {new Date(role.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                    {roles.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">
                          No roles found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted-foreground mt-4 italic text-center">Select a role from the sidebar to view or edit detailed permissions.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-6 border-b flex items-center justify-between bg-card z-10 shadow-sm">
                <div className="flex-1 max-w-2xl">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <Label>Role Name</Label>
                        <Input 
                          value={name} 
                          onChange={(e) => setName(e.target.value)} 
                          placeholder="e.g. Sales Manager"
                          className="mt-1 font-semibold text-lg"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input 
                          value={description} 
                          onChange={(e) => setDescription(e.target.value)} 
                          placeholder="Brief description of this role's purpose"
                          className="mt-1"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                        {selectedRole?.name}
                        {isAdminRole && <Shield className="w-5 h-5 text-destructive" />}
                      </h1>
                      <p className="text-muted-foreground mt-1">{selectedRole?.description}</p>
                      {isAdminRole && (
                        <p className="text-xs text-destructive mt-2 font-medium">
                          This is a system role. Permissions cannot be modified.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2 ml-4">
                  {!isEditing ? (
                    <>
                      <Button variant="outline" onClick={() => setIsEditing(true)} disabled={isAdminRole}>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit Role
                      </Button>
                      <Button variant="outline" onClick={handleCloneRole} disabled={!selectedRole} title="Duplicate this role with the same rights">
                        <Copy className="w-4 h-4 mr-2" />
                        Clone
                      </Button>
                      <Button variant="destructive" size="icon" onClick={() => selectedRole && handleDelete(selectedRole.id)} disabled={isAdminRole}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => selectedRole ? handleSelectRole(selectedRole) : setSelectedRole(null)}>
                        Cancel
                      </Button>
                      <Button onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Role
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Boxy Permissions Matrix */}
              <div className="flex-1 overflow-y-auto p-6 bg-muted/20">
                <div className="w-full max-w-none space-y-8">
                  

                  {/* A role carrying the `all` wildcard grants every permission in the
                      product. Without this banner the matrix below simply renders empty,
                      which reads as "no access" when it actually means "unrestricted". */}
                  {permissions.all && (
                    <Card className="p-4 border-destructive/50 bg-destructive/5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <Shield className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                          <div>
                            <h3 className="font-semibold text-foreground">Full Access (unrestricted)</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              This role bypasses every permission check, including payment approval,
                              credit limits and billing. The checklist below is hidden because nothing
                              in it applies.
                            </p>
                          </div>
                        </div>
                        {isEditing && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => {
                              const { all, ...rest } = permissions;
                              setPermissions(rest);
                            }}
                          >
                            Switch to granular
                          </Button>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* General Data Scope Setting */}
                  {!permissions.all && (
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">Global Data Visibility Scope</h3>
                          <p className="text-sm text-muted-foreground mt-1">Determine what records (Leads, Customers, etc.) this role can see across the CRM.</p>
                        </div>
                        <Select 
                          value={(permissions.global_scope as string) || 'own'} 
                          onValueChange={(val) => setPermissions({...permissions, global_scope: val || undefined, leads_scope: val || undefined, contacts_scope: val || undefined})}
                          disabled={!isEditing || isAdminRole}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DATA_SCOPES.map(scope => (
                              <SelectItem key={scope.value} value={scope.value}>
                                {scope.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Card>
                  )}

                  {/* Rights heading + global Select all */}
                  {!permissions.all && (
                    <div className="flex items-center justify-between border-b pb-2">
                      <h3 className="text-lg font-semibold text-foreground">Rights</h3>
                      {isEditing && !isAdminRole && (
                        <button
                          type="button"
                          onClick={() => toggleAllVisible(!allVisibleOn)}
                          className="flex items-center gap-2 text-sm text-foreground"
                        >
                          <span className={`flex w-5 h-5 items-center justify-center rounded border ${allVisibleOn ? "bg-primary border-primary text-primary-foreground" : "border-input bg-background"}`}>
                            {allVisibleOn && <Check className="w-3.5 h-3.5" />}
                          </span>
                          Select all
                        </button>
                      )}
                    </div>
                  )}

                  {/* Module-wise permission sections (reference layout: a grey header
                      bar with a select-all checkbox + the module name, then a
                      multi-column grid of that module's rights). */}
                  {!permissions.all && (
                    <div className="space-y-4 pb-20">
                      {visibleGroups.map((group, i) => {
                        const onCount = group.permissions.filter((p) => !!permissions[p.id]).length;
                        const total = group.permissions.length;
                        const allOn = onCount === total;
                        const someOn = onCount > 0 && !allOn;
                        const canToggle = isEditing && !isAdminRole;
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border overflow-hidden ${group.danger ? "border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.30)]" : "border-border"}`}
                          >
                            {/* Header bar — checkbox selects/clears the whole module */}
                            <button
                              type="button"
                              disabled={!canToggle}
                              onClick={() => toggleGroupAll(group, !allOn)}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left ${group.danger ? "bg-red-500/10" : "bg-muted/60"} ${canToggle ? "cursor-pointer hover:bg-muted" : "cursor-default"}`}
                            >
                              <span
                                className={`flex w-5 h-5 shrink-0 items-center justify-center rounded border ${
                                  allOn || someOn ? "bg-primary border-primary text-primary-foreground" : "border-input bg-background"
                                } ${!canToggle ? "opacity-60" : ""}`}
                              >
                                {allOn && <Check className="w-3.5 h-3.5" />}
                                {someOn && <Minus className="w-3.5 h-3.5" />}
                              </span>
                              <span className={`font-semibold text-sm flex items-center gap-2 ${group.danger ? "text-red-600" : "text-foreground"}`}>
                                {group.danger && <AlertCircle className="w-4 h-4" />}
                                {group.category}
                                {group.danger && (
                                  <span className="text-[10px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded bg-red-600 text-white">Danger</span>
                                )}
                                <span className="text-[11px] font-normal text-muted-foreground">({onCount}/{total})</span>
                              </span>
                            </button>

                            {group.note && (
                              <div className={`px-4 py-2 text-[11px] leading-snug border-b ${group.danger ? "bg-red-500/5 text-red-600/90" : "bg-amber-500/5 text-amber-700 dark:text-amber-400"}`}>
                                {group.note}
                              </div>
                            )}

                            {/* Rights grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-3 p-4 bg-card">
                              {group.permissions.map((perm) => {
                                const isChecked = !!permissions[perm.id];
                                return (
                                  <button
                                    key={perm.id}
                                    type="button"
                                    disabled={!canToggle}
                                    onClick={() => togglePermission(perm.id, !isChecked)}
                                    className={`flex items-center gap-2.5 text-left ${canToggle ? "cursor-pointer" : "cursor-default"}`}
                                  >
                                    <span
                                      className={`flex w-5 h-5 shrink-0 items-center justify-center rounded border ${
                                        isChecked ? "bg-primary border-primary text-primary-foreground" : "border-input bg-background"
                                      } ${!canToggle ? "opacity-60" : ""}`}
                                    >
                                      {isChecked && <Check className="w-3.5 h-3.5" />}
                                    </span>
                                    <span className="text-sm text-foreground leading-tight">{perm.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>
            </>
          )}
        </div>
    </div>
  );
}

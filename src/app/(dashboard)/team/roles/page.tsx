"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Shield, Plus, AlertCircle, Save, Trash2, Edit2, Users, Check } from "lucide-react";
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

const PERMISSION_GROUPS = [
  {
    category: "CRM & Sales",
    permissions: [
      { id: PERMISSIONS.CRM.VIEW_DASHBOARD, label: "View Main Dashboard" },
      { id: PERMISSIONS.CRM.VIEW_LEADS, label: "View Leads" },
      { id: PERMISSIONS.CRM.CREATE_LEADS, label: "Create Leads" },
      { id: PERMISSIONS.CRM.EDIT_LEADS, label: "Edit Leads" },
      { id: PERMISSIONS.CRM.DELETE_LEADS, label: "Delete Leads" },
      { id: PERMISSIONS.CRM.VIEW_CONTACTS, label: "View Customers" },
      { id: PERMISSIONS.CRM.CREATE_CONTACTS, label: "Create Customers" },
      { id: PERMISSIONS.CRM.EDIT_CONTACTS, label: "Edit Customers" },
      { id: PERMISSIONS.CRM.DELETE_CONTACTS, label: "Delete Customers" },
      { id: PERMISSIONS.CRM.VIEW_DEALS, label: "View Pipelines / Deals" },
      { id: PERMISSIONS.CRM.VIEW_PRODUCTS, label: "View Products" },
      { id: PERMISSIONS.CRM.VIEW_ORDERS, label: "View Quotations / Orders" },
      { id: PERMISSIONS.CRM.CREATE_ORDERS, label: "Create Orders" },
      { id: PERMISSIONS.CRM.EDIT_ORDERS, label: "Edit Orders" },
      { id: PERMISSIONS.CRM.MANAGE_ORDER_STATUS, label: "Manage Order Status (approve / reject / cancel)" },
      { id: PERMISSIONS.CRM.APPLY_ORDER_DISCOUNT, label: "Apply Discounts on Orders" },
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
      { id: PERMISSIONS.MOBILE.OFFLINE_MODE, label: "Allow Offline Sync" },
      { id: PERMISSIONS.MOBILE.VISIT_CHECKIN, label: "Allow Manual Check-ins" },
      { id: PERMISSIONS.MOBILE.EDIT_GEOTAG, label: "Edit Customer Geo-tag (Coordinates)" },
    ]
  },
  {
    category: "WhatsApp Features",
    permissions: [
      { id: PERMISSIONS.WHATSAPP.VIEW, label: "Access WhatsApp Dashboard" },
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
    category: "Administration",
    permissions: [
      { id: PERMISSIONS.ADMIN.VIEW_TEAM_MANAGEMENT, label: "Manage Employees & Roles" },
      { id: PERMISSIONS.ADMIN.BILLING, label: "Manage Subscription & Billing" },
      { id: PERMISSIONS.ADMIN.SETTINGS_GENERAL, label: "Access General Settings" },
    ]
  }
];

const DATA_SCOPES: { value: DataScope; label: string }[] = [
  { value: "own", label: "Own Records Only" },
  { value: "team", label: "Own & Team Records" },
  { value: "department", label: "Department Records" },
  { value: "company", label: "Entire Company" },
];

export default function RolesPage() {
  const { accountId, isSuperadmin, hasPermission } = useAuth();
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
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar - Roles List */}
        <div className="w-80 border-r bg-card flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2 text-foreground">
              <Shield className="w-4 h-4 text-muted-foreground" />
              Employee Roles
            </h2>
            <Button size="sm" onClick={handleNewRole} variant="outline">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : roles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-4">No roles found.</p>
            ) : (
              roles.map((role) => (
                <div
                  key={role.id}
                  onClick={() => handleSelectRole(role)}
                  className={`p-3 rounded-xl cursor-pointer border transition-all ${
                    selectedRole?.id === role.id && !isEditing
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium text-foreground">{role.name}</div>
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {role.description || "No description"}
                  </div>
                  {role.permissions?.all && (
                    <span className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm mt-2">
                      Admin (Full Access)
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Content - Role Details & Permissions */}
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

                  {/* Checklist Groups */}
                  {!permissions.all && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
                      {PERMISSION_GROUPS.map((group, i) => (
                        <Card key={i} className="overflow-hidden flex flex-col">
                          <div className="px-4 py-3 border-b bg-muted/50 font-semibold text-sm">
                            {group.category}
                          </div>
                          <div className="p-4 space-y-4 flex-1 bg-card">
                            {group.permissions.map((perm) => {
                              const isChecked = !!permissions[perm.id];
                              return (
                                <div key={perm.id} className="flex items-start gap-3">
                                  <div className="flex items-center h-5">
                                    <button
                                      type="button"
                                      disabled={!isEditing || isAdminRole}
                                      onClick={() => togglePermission(perm.id, !isChecked)}
                                      className={`flex w-5 h-5 items-center justify-center rounded border ${
                                        isChecked 
                                          ? "bg-primary border-primary text-primary-foreground" 
                                          : "border-input bg-background"
                                      } ${(isAdminRole || !isEditing) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                    >
                                      {isChecked && <Check className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                  <div className="flex flex-col">
                                    <label 
                                      className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${
                                        (isAdminRole || !isEditing) ? "cursor-not-allowed" : "cursor-pointer"
                                      }`}
                                      onClick={() => (!isAdminRole && isEditing) && togglePermission(perm.id, !isChecked)}
                                    >
                                      {perm.label}
                                    </label>
                                    <span className="text-[10px] text-muted-foreground font-mono mt-1 opacity-70">
                                      key: {perm.id}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}

                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
import type { RolePermissions, DataScope } from "@/lib/auth/rbac";
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
      { id: "view_dashboard", label: "View Main Dashboard" },
      { id: "view_leads", label: "View Leads" },
      { id: "add_leads", label: "Add Leads" },
      { id: "edit_leads", label: "Edit Leads" },
      { id: "delete_leads", label: "Delete Leads" },
      { id: "view_contacts", label: "View Contacts" },
      { id: "add_contacts", label: "Add Contacts" },
      { id: "edit_contacts", label: "Edit Contacts" },
      { id: "delete_contacts", label: "Delete Contacts" },
      { id: "view_deals", label: "View Pipelines / Deals" },
      { id: "view_products", label: "View Products" },
      { id: "view_orders", label: "View Quotations / Orders" },
    ]
  },
  {
    category: "Task Management",
    permissions: [
      { id: "view_tasks", label: "View Tasks" },
      { id: "create_task", label: "Create Task" },
      { id: "edit_task", label: "Edit Task" },
      { id: "delete_task", label: "Delete Task" },
      { id: "assign_tasks_parent", label: "Assign Tasks to Parent User" },
      { id: "assign_tasks_child", label: "Assign Tasks to Child User" },
      { id: "assign_tasks_all", label: "Assign Tasks to All Users" },
    ]
  },
  {
    category: "Mobile App & Field Force",
    permissions: [
      { id: "view_location_tracking", label: "View Location Dashboard (Web)" },
      { id: "mobile_location_screen", label: "Location Map Screen (Mobile)" },
      { id: "allow_logout", label: "Allow Mobile Logout" },
      { id: "mobile_offline_mode", label: "Allow Offline Sync" },
      { id: "mobile_visit_checkin", label: "Allow Manual Check-ins" },
    ]
  },
  {
    category: "WhatsApp Features",
    permissions: [
      { id: "view_whatsapp", label: "Access WhatsApp Dashboard" },
      { id: "view_whatsapp_broadcasts", label: "Manage Broadcasts" },
      { id: "view_whatsapp_automations", label: "Manage Automations" },
      { id: "view_whatsapp_flows", label: "Manage Workflows" },
      { id: "view_whatsapp_templates", label: "Manage Message Templates" },
      { id: "view_ai_assistant", label: "Manage AI Knowledge Base" },
    ]
  },
  {
    category: "Administration",
    permissions: [
      { id: "view_team_management", label: "Manage Employees & Roles" },
      { id: "billing", label: "Manage Subscription & Billing" },
      { id: "settings_general", label: "Access General Settings" },
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

  const isAdminRole = selectedRole?.name === "Admin";

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
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary mt-2">
                      Full Access
                    </span>
                  )}
                  {role.name === "Admin" && (
                    <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive mt-2 ml-2">
                      System Locked
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
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Shield className="w-16 h-16 mb-4 opacity-20" />
              <p>Select a role to view or edit permissions</p>
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
                <div className="max-w-5xl mx-auto space-y-8">
                  
                  {/* Super Admin Override */}
                  <Card className={`p-4 transition-colors ${permissions.all ? 'border-primary bg-primary/5' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          Full System Access (Super Admin)
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Grant this role absolute access to all modules, settings, and bypass all restrictions.
                        </p>
                      </div>
                      <Switch 
                        checked={permissions.all === true} 
                        onCheckedChange={(c) => setPermissions({ ...permissions, all: c })}
                        disabled={!isEditing || isAdminRole}
                      />
                    </div>
                  </Card>

                  {/* General Data Scope Setting */}
                  {!permissions.all && (
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">Global Data Visibility Scope</h3>
                          <p className="text-sm text-muted-foreground mt-1">Determine what records (Leads, Contacts, etc.) this role can see across the CRM.</p>
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

"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Shield, Plus, AlertCircle, Save, Trash2, Edit2, Users, Check, Minus, Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import type { RolePermissions } from "@/lib/auth/rbac";
import {
  PERMISSION_GROUPS,
  type PermGroup,
  type PermLine,
} from "@/lib/auth/permission-groups";
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


// Maps each rights section to the plan line that unlocks it. Groups not listed
// here are base features shown on every plan. A group is only shown if the
// account's purchased plan includes its line (CRM / SFA / WFA).
const GROUP_LINE: Record<string, "crm" | "sfa" | "wfa"> = {
  "Leads": "crm",
  "Deals / Pipeline": "crm",
  "WhatsApp Features": "crm",
  "Masters — Leads & Deals": "crm",
  "Catalogue (Products)": "sfa",
  "Quotations": "sfa",
  "Orders": "sfa",
  "Dispatch": "sfa",
  "Payments & Finance": "sfa",
  "Customer Financials": "sfa",
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

// Maps a rights section to an Organization-Settings module toggle. A section is
// hidden when that module is switched OFF in settings. Groups not listed are
// always shown (no toggle).
const GROUP_MODULE: Record<string, keyof ModuleSettings> = {
  "Quotations": "quotation",
  "Dispatch": "dispatch",
  "Expenses": "expense",
  "Payments & Finance": "payment",
  "Schemes & Pricing": "scheme",
  "Stock / Inventory": "stock",
  "WhatsApp Features": "whatsapp",
  "Route Management": "route",
  "Masters — Geography & Field": "territory",
  // Data Visibility (view_child/parent_data) is meaningless without a reporting tree, so it only
  // appears when Reporting Hierarchy is enabled in Organisation Settings.
  "Data Visibility": "reporting_hierarchy",
};

export default function RolesPage() {
  const { accountId, isSuperadmin, hasPermission, hasCRM, hasSFA, hasWFA, isModuleEnabled, moduleSettingsLoaded } = useAuth();

  // Rights sections visible for this account: (1) the plan line must be owned,
  // and (2) the module must be enabled in Organization Settings. Login Access is
  // pinned first.
  const visibleGroups = useMemo(() => {
    const lineOk = (cat: string) => {
      const line = GROUP_LINE[cat];
      if (!line) return true; // base feature — always shown
      if (line === "crm") return hasCRM;
      if (line === "sfa") return hasSFA;
      if (line === "wfa") return hasWFA;
      return true;
    };
    const moduleOk = (cat: string) => {
      const mod = GROUP_MODULE[cat];
      return !mod || isModuleEnabled(mod); // no toggle → always shown; else honor the setting
    };
    const permLineOk = (line?: PermLine) => {
      if (!line) return true;
      if (line === "crm") return hasCRM;
      if (line === "sfa") return hasSFA;
      return hasWFA;
    };
    const shown = PERMISSION_GROUPS
      .filter((g) => lineOk(g.category) && moduleOk(g.category))
      // Drop individual rights whose own line the plan doesn't own (e.g. the
      // CRM "Lead & Deal Reports" right inside the shared Reports group).
      .map((g) => ({ ...g, permissions: g.permissions.filter((p) => permLineOk(p.line)) }))
      .filter((g) => g.permissions.length > 0);
    const top = shown.filter((g) => g.category === "Login Access");
    const rest = shown.filter((g) => g.category !== "Login Access");
    return [...top, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCRM, hasSFA, hasWFA, isModuleEnabled, moduleSettingsLoaded]);
  // Inline "find a right" filter. Prefilled + focused when the command palette
  // deep-links here with ?find=<permission label>.
  const searchParams = useSearchParams();
  const [rightsFilter, setRightsFilter] = useState("");
  useEffect(() => {
    const f = searchParams.get("find");
    if (f) setRightsFilter(f);
  }, [searchParams]);

  const displayGroups = useMemo(() => {
    const q = rightsFilter.trim().toLowerCase();
    if (!q) return visibleGroups;
    return visibleGroups
      .map((g) => {
        if (g.category.toLowerCase().includes(q)) return g;
        const perms = g.permissions.filter((p) => p.label.toLowerCase().includes(q));
        return perms.length > 0 ? { ...g, permissions: perms } : null;
      })
      .filter((g): g is (typeof visibleGroups)[number] => g !== null);
  }, [visibleGroups, rightsFilter]);

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
    // New roles get web + mobile login access by default (admin unticks to deny),
    // so the Login Access checkboxes read truthfully out of the box.
    setPermissions({ web_access: true, mobile_access: true });
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

                  {/* The old own/team "Global Data Visibility Scope" selector was replaced by the
                      directional "Data Visibility" rights (view_child_data / view_parent_data) in
                      the permission list above — enforced app-level (Phase 9). */}

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
                      {/* Find a specific right (also targeted by the global search). */}
                      <div className="sticky top-0 z-10 -mx-1 bg-card/95 px-1 pb-2 pt-1 backdrop-blur">
                        <Input
                          value={rightsFilter}
                          onChange={(e) => setRightsFilter(e.target.value)}
                          placeholder="Find a right… (e.g. Export, Approve, Stock)"
                          className="h-8 max-w-sm"
                        />
                      </div>
                      {displayGroups.length === 0 && (
                        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                          No rights match “{rightsFilter}”.
                        </p>
                      )}
                      {displayGroups.map((group, i) => {
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

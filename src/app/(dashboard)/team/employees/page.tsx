"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Users, Search, Smartphone, Shield, AlertCircle, Edit, Plus, UserPlus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageLayout, PageHeader, StatusBadge, ConfirmDialog } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTableView } from "@/hooks/use-table-view";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { REFERENCE_ROW_CAP } from "@/lib/table/reference-cap";
import { getVisibleTableColumns } from "@/lib/custom-fields";
import { extraColumns, type ExtraColumnSpec } from "@/lib/table/extra-columns";
import { matchesColumnFilters } from "@/lib/table/match-filters";
import type { CustomField } from "@/types";

interface Employee {
  id: string;
  full_name: string;
  email: string;
  employee_code: string;
  mobile: string;
  department: string;
  designation: string;
  status: string;
  web_access: boolean;
  mobile_access: boolean;
  employee_role_id: string;
  employee_roles?: { name: string };
  account_role: string;
}

interface Device {
  id: string;
  device_name: string;
  device_model: string;
  os: string;
  status: string;
  last_login: string;
}

/** Stored employee fields with no hand-written column, shown via Manage Column. */
const EMPLOYEE_EXTRA_COLUMNS: readonly ExtraColumnSpec<Employee>[] = [
  ["employee_code", "Employee Code", "text"],
  ["email", "Email", "text"],
  ["mobile", "Contact Number", "text"],
  ["phone", "Phone", "text"],
  ["department", "Department", "text"],
  ["designation", "Designation", "text"],
  ["branch", "Branch", "text"],
  ["created_at", "Joined", "date"],
];

/** Built once: the match below needs them, and they never change. */
const EMPLOYEE_EXTRA_DEFS = extraColumns<Employee>(EMPLOYEE_EXTRA_COLUMNS);

export default function EmployeesPage() {
  const router = useRouter();
  const { accountId, hasPermission, isSuperadmin } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [holidayLists, setHolidayLists] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [deactivateTarget, setDeactivateTarget] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  
  const [search, setSearch] = useState("");
  const tableView = useTableView("wacrm_employees_table_columns", { status: ["active"] });
  const { filterState } = tableView;
  
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Edit Form State
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [saving, setSaving] = useState(false);

  // Add Form State
  const [addForm, setAddForm] = useState({
    full_name: "",
    email: "",
    password: "",
    employee_code: "",
    mobile: "",
    department: "",
    employee_role_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const supabase = createClient();

  useEffect(() => {
    if (accountId) {
      fetchData();
    }
  }, [accountId]);

  const fetchData = async () => {
    setLoading(true);
    
    // The account filter is belt and braces, not decoration. `profiles_select`
    // used to carry an `OR is_superadmin()` branch, and because a row policy
    // cannot tell which screen is asking, this list showed the founder every
    // tenant's staff. The branch is gone (migration 20261016120000); the filter
    // means a future policy mistake cannot leak the list again.
    const { data: empData, error: empError } = await supabase
      .from("profiles")
      .select("*, employee_roles(name), holiday_lists(id, name, is_default)")
      .eq("account_id", accountId)
      .order("full_name")
      .limit(REFERENCE_ROW_CAP);

    if (empError) toast.error("Failed to load employees");
    else setEmployees(empData || []);

    // The account's own field configuration for this module — its headings,
    // which fields it hides from the table, and any field it added itself.
    const { data: cfData } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("account_id", accountId)
      .eq("module_name", "user");
    setCustomFields((cfData ?? []) as CustomField[]);

    // Needed for the Holiday List column filter options and to name the default list.
    const { data: listData } = await supabase
      .from("holiday_lists")
      .select("id, name, is_default")
      .order("name");
    setHolidayLists(listData || []);

    const { data: roleData } = await supabase
      .from("employee_roles")
      .select("id, name, permissions")
      .eq("status", "active");
    if (roleData) setRoles(roleData);

    setLoading(false);
  };

  const fetchDevices = async (profileId: string) => {
    const { data } = await supabase
      .from("employee_devices")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });
    setDevices(data || []);
  };

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEditForm({ ...employee });
    fetchDevices(employee.id);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedEmployee) return;
    setSaving(true);

    // Derive the security level from the chosen Employee Role; never demote Owner.
    const selRole = roles.find((r) => r.id === editForm.employee_role_id) as { permissions?: { all?: boolean } } | undefined;
    const derivedAccountRole =
      selectedEmployee.account_role === "owner" ? "owner" : selRole?.permissions?.all === true ? "admin" : "agent";

    // Editing another user's profile has to go through the service-role route:
    // `profiles_update` only permits a user to write their own row, so the
    // direct client update this used to do silently affected zero rows.
    let error: { message: string } | null = null;
    try {
      const res = await fetch("/api/team/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedEmployee.id,
          updates: {
            employee_code: editForm.employee_code,
            mobile: editForm.mobile,
            department: editForm.department,
            employee_role_id: editForm.employee_role_id,
            account_role: derivedAccountRole,
            status: editForm.status,
            web_access: editForm.web_access,
            mobile_access: editForm.mobile_access,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) error = { message: data.error || "Failed to update employee" };
    } catch (e: any) {
      error = { message: e?.message || "Failed to update employee" };
    }

    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Employee updated");
      setIsEditModalOpen(false);
      fetchData();
    }
  };

  const doDeactivate = async () => {
    const empId = deactivateTarget;
    if (!empId) return;
    setDeactivating(true);
    // Optimistically update UI so it disappears immediately
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, status: "inactive" } : e));
    try {
      const res = await fetch("/api/team/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: empId, updates: { status: "inactive" } })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deactivate");
      toast.success("Employee marked as inactive");
    } catch (err: any) {
      toast.error(err.message);
      fetchData(); // Revert on error
    } finally {
      setDeactivating(false);
      setDeactivateTarget(null);
    }
  };

  const handleReactivate = async (empId: string) => {
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, status: "active" } : e));
    try {
      const res = await fetch("/api/team/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: empId, updates: { status: "active" } })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to re-activate");
      toast.success("Employee re-activated");
    } catch (err: any) {
      toast.error(err.message);
      fetchData();
    }
  };

  const handleCreateEmployee = async () => {
    if (!addForm.full_name || !addForm.email || !addForm.password || !addForm.employee_role_id) {
      toast.error("Please fill all required fields (Name, Email, Password, Role)");
      return;
    }
    
    setCreating(true);
    try {
      const selRole = roles.find((r) => r.id === addForm.employee_role_id) as { permissions?: { all?: boolean } } | undefined;
      const account_role = selRole?.permissions?.all === true ? "admin" : "agent";
      const res = await fetch("/api/team/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addForm,
          account_id: accountId,
          account_role,
        })
      });
      
      const data = await res.json();
      
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to create employee");
      }
      
      toast.success("Employee created successfully and credentials generated!");
      setIsAddModalOpen(false);
      
      // Reset form
      setAddForm({
        full_name: "", email: "", password: "", employee_code: "",
        mobile: "", department: "", employee_role_id: ""
      });
      
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeviceAction = async (deviceId: string, action: "active" | "rejected" | "inactive") => {
    const { error } = await supabase
      .from("employee_devices")
      .update({ status: action })
      .eq("id", deviceId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Device marked as ${action}`);
      if (selectedEmployee) fetchDevices(selectedEmployee.id);
    }
  };

  // NOTE: the "Access Denied" permission guard must NOT early-return here — the
  // `columns` useMemo below is a hook, and returning before it changes the hook
  // count between renders (permissions resolve async), which crashes React with
  // error #310 ("rendered fewer hooks than expected"). The guard is applied after
  // all hooks, just before the main return.

  const filtered = employees.filter(e => {
    // Global search
    const matchesSearch = e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_code?.toLowerCase().includes(search.toLowerCase());
      
    // Column filter: Employee name (text)
    const empFilter = filterState.employee as string;
    const matchesEmp = !empFilter || e.full_name?.toLowerCase().includes(empFilter.toLowerCase());
      
    // Column filter: Status (select array)
    const statusFilters = filterState.status as string[] | undefined;
    const matchesStatus = !statusFilters || statusFilters.length === 0 || statusFilters.includes(e.status);
    
    // Column filter: Role (select array)
    const roleFilters = filterState.role as string[] | undefined;
    const matchesRole = !roleFilters || roleFilters.length === 0 || roleFilters.includes(e.employee_role_id);

    // Column filter: Holiday List (select array). The control existed but was
    // never applied. A NULL assignment is not "none" — it means the employee
    // follows the account default, exactly as the cell renders it, so it has
    // to match the default list.
    const holidayFilters = filterState.holiday_list as string[] | undefined;
    const effectiveListId =
      (e as { holiday_list_id?: string | null }).holiday_list_id ??
      holidayLists.find((l) => l.is_default)?.id;
    const matchesHoliday =
      !holidayFilters ||
      holidayFilters.length === 0 ||
      (effectiveListId !== undefined && holidayFilters.includes(effectiveListId));

    // The columns Manage Column offers for the rest of the stored fields.
    const matchesExtra = matchesColumnFilters(e, filterState, EMPLOYEE_EXTRA_DEFS);

    return (
      matchesSearch && matchesEmp && matchesStatus && matchesRole && matchesHoliday && matchesExtra
    );
  });

  const columns: ColumnDef<Employee>[] = useMemo(() => [
    {
      id: "employee",
      label: "Employee",
      type: "text",
      render: (emp) => (
        <div>
          <div className="font-medium text-foreground">{emp.full_name || "Unknown"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{emp.email} {emp.employee_code && `• ${emp.employee_code}`}</div>
        </div>
      ),
    },
    {
      id: "role",
      label: "Employee Role",
      type: "select",
      options: roles.map(r => ({ label: r.name, value: r.id })),
      render: (emp) => {
        const displayRole = emp.account_role === "owner" ? "admin" : emp.account_role;
        return (
          <div className="flex items-center gap-2">
            <StatusBadge status="assigned" label={emp.employee_roles?.name || "Unassigned"} />
            {(displayRole === "admin") && (
              <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500 font-semibold capitalize">{displayRole}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "holiday_list",
      label: "Holiday List",
      type: "select",
      options: holidayLists.map((l) => ({ label: l.name, value: l.id })),
      render: (emp) => {
        // A NULL assignment is not "none" — it means the employee follows the account default,
        // so showing a blank here would read as "no calendar", which is never true.
        const assigned = (emp as any).holiday_lists as { name: string } | null;
        const fallback = holidayLists.find((l) => l.is_default);
        if (assigned) return <span className="text-sm">{assigned.name}</span>;
        return (
          <span className="text-sm text-muted-foreground">
            {fallback ? `${fallback.name} (default)` : "—"}
          </span>
        );
      },
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
      ],
      render: (emp) => (
        <StatusBadge status={emp.status === "active" ? "active" : "inactive"} label={emp.status || "active"} />
      ),
    },
    {
      id: "actions",
      label: "Action",
      type: "text",
      render: (emp) => {
        const isAdmin = emp.account_role === 'admin' || emp.account_role === 'owner';
        const inactive = emp.status === "inactive";
        return (
          <RowActions
            isInactive={inactive}
            editTitle="Manage"
            onEdit={() => router.push(`/team/employees/${emp.id}`)}
            // Admins/owners can't be deactivated; hide the trash for them.
            onDelete={!isAdmin ? () => setDeactivateTarget(emp.id) : undefined}
            onReactivate={() => handleReactivate(emp.id)}
            deleteTitle="Deactivate"
            reactivateTitle="Re-activate"
          />
        );
      },
    },
  ], [roles, router, holidayLists]);

  /**
   * Every other stored employee field, so Manage Column can offer it.
   *
   * This screen defined four columns, so Contact Number, Employee Code,
   * Email, Department, Designation and Branch could not be shown at all — the
   * account has `mobile` configured as "Contact Number" with show-in-table on,
   * and it still never reached Manage Column because no column existed for it.
   *
   * All hidden by default, so nothing about the current table changes until
   * somebody ticks one.
   */
  const employeeExtraColumns = useMemo(
    () => extraColumns<Employee>(EMPLOYEE_EXTRA_COLUMNS),
    [],
  );

  /**
   * The account's own configuration for this module, matched by system key:
   * its headings, which fields it hides, and any field it added itself —
   * "Joining Date" and "Ulternate Number" on this account. Every other module
   * with custom fields already did this; Employees did not, so none of them
   * could ever appear.
   */
  const tableColumns = useMemo(
    () => getVisibleTableColumns([...columns, ...employeeExtraColumns], customFields, employees),
    [columns, employeeExtraColumns, customFields, employees],
  );

  // Permission guard — safe here because every hook above has already run, so the
  // hook count is identical whether or not this returns early (avoids React #310).
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

  return (
    <PageLayout fill>
      <PageHeader
        title="Employees"
        subtitle="Manage your team, credentials, and device access."
        actions={
          <Button data-tour="employee-add" onClick={() => router.push('/team/employees/new')} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
        }
      />

      <DataTable
        fill
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search employees...",
        }}
        columns={tableColumns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(emp) => emp.id}
        rowHref={(emp) => `/team/employees/${emp.id}`}
      />

      {/* Add Employee Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>
              This will create their login credentials and assign them to a role.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={addForm.full_name} onChange={e => setAddForm({...addForm, full_name: e.target.value})} placeholder="e.g. John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Employee ID / Code</Label>
                <Input value={addForm.employee_code} onChange={e => setAddForm({...addForm, employee_code: e.target.value})} placeholder="e.g. EMP-001" />
              </div>
              <div className="space-y-2">
                <Label>Email Address (Login ID) *</Label>
                <Input value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} placeholder="john@example.com" type="email" />
              </div>
              <div className="space-y-2">
                <Label>Password *</Label>
                <Input value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} placeholder="********" type="text" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="space-y-2">
                <Label>Employee Role *</Label>
                <Select
                  value={addForm.employee_role_id}
                  onValueChange={v => setAddForm({...addForm, employee_role_id: v || ""})}
                  items={Object.fromEntries(roles.map(r => [r.id, r.name]))}
                >
                  <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">A role with Full Access makes this employee an admin.</p>
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input value={addForm.mobile} onChange={e => setAddForm({...addForm, mobile: e.target.value})} placeholder="+1 234 567 8900" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateEmployee} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Employee & Device Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Employee</DialogTitle>
          </DialogHeader>

          {selectedEmployee && (
            <div className="space-y-8 py-4">
              {/* Basic Details */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Business Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Employee Code</Label>
                    <Input value={editForm.employee_code || ""} onChange={e => setEditForm({...editForm, employee_code: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Mobile</Label>
                    <Input value={editForm.mobile || ""} onChange={e => setEditForm({...editForm, mobile: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* Roles & Access */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Access & Permissions</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Employee Role</Label>
                    <Select
                      value={editForm.employee_role_id || ""}
                      onValueChange={v => setEditForm({...editForm, employee_role_id: v || undefined})}
                      items={Object.fromEntries(roles.map(r => [r.id, r.name]))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account Status</Label>
                    <Select value={editForm.status || "active"} onValueChange={v => setEditForm({...editForm, status: v || undefined})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
                    <div>
                      <Label className="text-base text-foreground">Web Portal Access</Label>
                      <p className="text-xs text-muted-foreground">Can log in from browser</p>
                    </div>
                    <Switch checked={editForm.web_access ?? true} onCheckedChange={c => setEditForm({...editForm, web_access: c})} />
                  </div>
                  <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
                    <div>
                      <Label className="text-base text-foreground">Mobile App Access</Label>
                      <p className="text-xs text-muted-foreground">Can use field force app</p>
                    </div>
                    <Switch checked={editForm.mobile_access ?? true} onCheckedChange={c => setEditForm({...editForm, mobile_access: c})} />
                  </div>
                </div>
              </div>

              {/* Mobile Device Security */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Smartphone className="w-4 h-4" />
                    Mobile Device Security
                  </h3>
                </div>
                
                {devices.length === 0 ? (
                  <div className="text-center p-6 bg-muted/20 rounded-lg border border-dashed border-border">
                    <p className="text-sm text-muted-foreground">No mobile devices registered yet. Employee must log in to the mobile app first.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {devices.map(device => (
                      <div key={device.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
                        <div>
                          <div className="font-medium text-sm flex items-center gap-2 text-foreground">
                            {device.device_name || "Unknown Device"} 
                            {device.status === 'active' && <span className="bg-emerald-600 text-white shadow-sm px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Active</span>}
                            {device.status === 'pending' && <span className="bg-amber-600 text-white shadow-sm px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider animate-pulse">Pending</span>}
                            {device.status === 'rejected' && <span className="bg-red-600 text-white shadow-sm px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Rejected</span>}
                            {device.status === 'inactive' && <span className="bg-slate-600 text-white shadow-sm px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Logged Out</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {device.device_model} • {device.os}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {device.status === 'pending' && (
                            <>
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" onClick={() => handleDeviceAction(device.id, 'active')}>Approve</Button>
                              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white shadow-sm" onClick={() => handleDeviceAction(device.id, 'rejected')}>Reject</Button>
                            </>
                          )}
                          {device.status === 'active' && (
                            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm" onClick={() => handleDeviceAction(device.id, 'inactive')}>Force Logout</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => { if (!o) setDeactivateTarget(null); }}
        title="Deactivate employee"
        description="Deactivate this employee? They will be marked Inactive and lose access, but you can re-activate them anytime."
        variant="danger"
        confirmLabel="Deactivate"
        loading={deactivating}
        onConfirm={doDeactivate}
      />
    </PageLayout>
  );
}

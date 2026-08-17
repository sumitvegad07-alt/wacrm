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
import { PageLayout, PageHeader, PageToolbar, StatusBadge } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";

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

export default function EmployeesPage() {
  const router = useRouter();
  const { accountId, hasPermission, isSuperadmin } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [holidayLists, setHolidayLists] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<FilterState>({ status: ["active"] });
  
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

  const supabase = createClient();

  useEffect(() => {
    if (accountId) {
      fetchData();
    }
  }, [accountId]);

  const fetchData = async () => {
    setLoading(true);
    
    const { data: empData, error: empError } = await supabase
      .from("profiles")
      .select("*, employee_roles(name), holiday_lists(id, name, is_default)")
      .order("full_name");

    if (empError) toast.error("Failed to load employees");
    else setEmployees(empData || []);

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

    const { error } = await supabase
      .from("profiles")
      .update({
        employee_code: editForm.employee_code,
        mobile: editForm.mobile,
        department: editForm.department,
        employee_role_id: editForm.employee_role_id,
        account_role: derivedAccountRole,
        status: editForm.status,
        web_access: editForm.web_access,
        mobile_access: editForm.mobile_access,
      })
      .eq("id", selectedEmployee.id);

    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Employee updated");
      setIsEditModalOpen(false);
      fetchData();
    }
  };

  const handleDeactivate = async (empId: string) => {
    if (!confirm("Are you sure you want to deactivate this employee?")) return;
    
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
    
    return matchesSearch && matchesEmp && matchesStatus && matchesRole;
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
      label: "Actions",
      type: "text",
      render: (emp) => {
        const isAdmin = emp.account_role === 'admin' || emp.account_role === 'owner';
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/team/employees/${emp.id}`); }}>
              <Edit className="w-4 h-4 mr-2" />
              Manage
            </Button>
            {emp.status !== "inactive" && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isAdmin}
                onClick={(e) => { e.stopPropagation(); handleDeactivate(emp.id); }}
                title={isAdmin ? "Admins cannot be deactivated" : "Deactivate employee"}
              >
                Deactivate
              </Button>
            )}
          </div>
        );
      },
    },
  ], [roles, router, holidayLists]);

  return (
    <PageLayout>
      <PageHeader
        title="Employees"
        subtitle="Manage your team, credentials, and device access."
        actions={
          <Button onClick={() => router.push('/team/employees/new')} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
        }
      />

      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search employees...",
        }}
      />

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, value) => setFilterState(prev => ({ ...prev, [id]: value }))}
        storageKey="wacrm_employees_table_columns"
        isLoading={loading}
        rowKey={(emp) => emp.id}
        onRowClick={(emp) => router.push(`/team/employees/${emp.id}`)}
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
    </PageLayout>
  );
}

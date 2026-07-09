"use client";

import { useState, useEffect } from "react";
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
  const { accountId, hasPermission, isSuperadmin } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState("");
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
    designation: "",
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
      .select("*, employee_roles(name)")
      .order("full_name");

    if (empError) toast.error("Failed to load employees");
    else setEmployees(empData || []);

    const { data: roleData } = await supabase
      .from("employee_roles")
      .select("id, name")
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

    const { error } = await supabase
      .from("profiles")
      .update({
        employee_code: editForm.employee_code,
        mobile: editForm.mobile,
        department: editForm.department,
        designation: editForm.designation,
        employee_role_id: editForm.employee_role_id,
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

  const handleCreateEmployee = async () => {
    if (!addForm.full_name || !addForm.email || !addForm.password || !addForm.employee_role_id) {
      toast.error("Please fill all required fields (Name, Email, Password, Role)");
      return;
    }
    
    setCreating(true);
    try {
      const res = await fetch("/api/team/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addForm,
          account_id: accountId,
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
        mobile: "", department: "", designation: "", employee_role_id: ""
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

  const filtered = employees.filter(e => 
    e.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    e.email?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Employees</h1>
          <p className="text-muted-foreground">Manage your team, credentials, and device access.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search employees..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64 bg-card"
            />
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b font-medium text-muted-foreground">
              <tr>
                <th className="px-6 py-4">Employee</th>
                <th className="px-6 py-4">Designation</th>
                <th className="px-6 py-4">Business Role</th>
                <th className="px-6 py-4">System Role</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-foreground">{emp.full_name || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{emp.email} {emp.employee_code && `• ${emp.employee_code}`}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-foreground">{emp.designation || "-"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{emp.department || ""}</div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant="secondary" className="font-normal bg-primary/10 text-primary hover:bg-primary/20">
                      {emp.employee_roles?.name || "Unassigned"}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 capitalize text-muted-foreground">
                    {emp.account_role}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge variant="outline" className={emp.status === 'active' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'}>
                      {emp.status || 'active'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEditModal(emp)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add Employee Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-xl">
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
                <Label>Temporary Password *</Label>
                <Input value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} placeholder="********" type="text" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="space-y-2">
                <Label>Business Role *</Label>
                <Select value={addForm.employee_role_id} onValueChange={v => setAddForm({...addForm, employee_role_id: v || ""})}>
                  <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input value={addForm.mobile} onChange={e => setAddForm({...addForm, mobile: e.target.value})} placeholder="+1 234 567 8900" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={addForm.department} onChange={e => setAddForm({...addForm, department: e.target.value})} placeholder="e.g. Sales" />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={addForm.designation} onChange={e => setAddForm({...addForm, designation: e.target.value})} placeholder="e.g. Field Executive" />
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Input value={editForm.department || ""} onChange={e => setEditForm({...editForm, department: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Designation</Label>
                    <Input value={editForm.designation || ""} onChange={e => setEditForm({...editForm, designation: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* Roles & Access */}
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Access & Permissions</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Business Role</Label>
                    <Select value={editForm.employee_role_id || ""} onValueChange={v => setEditForm({...editForm, employee_role_id: v || undefined})}>
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
                            {device.status === 'active' && <span className="bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Active</span>}
                            {device.status === 'pending' && <span className="bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider animate-pulse">Pending</span>}
                            {device.status === 'rejected' && <span className="bg-red-500/10 text-red-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Rejected</span>}
                            {device.status === 'inactive' && <span className="bg-slate-500/10 text-slate-400 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Logged Out</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {device.device_model} • {device.os}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {device.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-500/10" onClick={() => handleDeviceAction(device.id, 'active')}>Approve</Button>
                              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-500/10" onClick={() => handleDeviceAction(device.id, 'rejected')}>Reject</Button>
                            </>
                          )}
                          {device.status === 'active' && (
                            <Button size="sm" variant="outline" className="text-orange-600 border-orange-200 hover:bg-orange-500/10" onClick={() => handleDeviceAction(device.id, 'inactive')}>Force Logout</Button>
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

    </div>
  );
}

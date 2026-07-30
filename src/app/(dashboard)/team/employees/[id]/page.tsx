"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, User, Shield, Mail, Phone, Building2, Briefcase, 
  Smartphone, Lock, Unlock, Key, Trash2, Edit2, CheckCircle2, 
  XCircle, AlertCircle, Loader2, Save, MapPin, RefreshCw 
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import type { Employee, EmployeeRole, EmployeeDevice, CustomField } from "@/types";

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const { accountId } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [devices, setDevices] = useState<EmployeeDevice[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Edit form state
  const [form, setForm] = useState({
    full_name: "",
    employee_code: "",
    email: "",
    mobile: "",
    department: "",
    designation: "",
    employee_role_id: "",
    account_role: "member",
    status: "active"
  });

  const [passwordForm, setPasswordForm] = useState({
    new_password: "",
    confirm_password: ""
  });
  const [resettingPassword, setResettingPassword] = useState(false);

  const fetchEmployeeData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch employee details
      const { data: empData, error: empErr } = await supabase
        .from("profiles")
        .select("*, employee_roles(id, name, permissions)")
        .eq("id", employeeId)
        .single();

      if (empErr || !empData) {
        toast.error("Employee not found");
        router.push("/team/employees");
        return;
      }

      setEmployee(empData as Employee);
      setForm({
        full_name: empData.full_name || "",
        employee_code: empData.employee_code || "",
        email: empData.email || "",
        mobile: empData.mobile || "",
        department: empData.department || "",
        designation: empData.designation || "",
        employee_role_id: empData.employee_role_id || "",
        account_role: empData.account_role || "member",
        status: empData.status || "active"
      });

      // Fetch employee roles
      const { data: rolesData } = await supabase
        .from("employee_roles")
        .select("*")
        .order("name", { ascending: true });
      if (rolesData) setRoles(rolesData as EmployeeRole[]);

      // Fetch devices
      const { data: devData } = await supabase
        .from("employee_devices")
        .select("*")
        .eq("user_id", employeeId)
        .order("last_seen_at", { ascending: false });
      if (devData) setDevices(devData as EmployeeDevice[]);

      const { data: fieldsData } = await supabase
        .from("custom_fields")
        .select("*")
        .eq("module_name", "user")
        .order("created_at");
      if (fieldsData) setCustomFields(fieldsData);

      const { data: cvData } = await supabase
        .from("user_custom_values")
        .select("*")
        .eq("user_id", employeeId);
      if (cvData) {
        const vals: Record<string, string> = {};
        cvData.forEach((row: any) => { vals[row.custom_field_id] = row.value; });
        setCustomValues(vals);
      } else {
        setCustomValues({});
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load employee details");
    } finally {
      setLoading(false);
    }
  }, [employeeId, supabase, router]);

  useEffect(() => {
    fetchEmployeeData();
  }, [fetchEmployeeData]);

  const handleSaveEmployee = async () => {
    if (!form.full_name.trim()) {
      toast.error("Full Name is required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim(),
          employee_code: form.employee_code.trim() || null,
          mobile: form.mobile.trim() || null,
          department: form.department.trim() || null,
          designation: form.designation.trim() || null,
          employee_role_id: form.employee_role_id || null,
          account_role: form.account_role as any,
          status: form.status
        })
        .eq("id", employeeId);

      if (error) throw error;
      if (employeeId && Object.keys(customValues).length > 0) {
        await supabase.from("user_custom_values").delete().eq("user_id", employeeId);
        const toInsert = Object.entries(customValues)
          .filter(([_, val]) => val !== undefined && val !== '')
          .map(([fieldId, val]) => ({
            account_id: accountId,
            user_id: employeeId,
            custom_field_id: fieldId,
            value: val
          }));
        if (toInsert.length > 0) {
          await supabase.from("user_custom_values").insert(toInsert);
        }
      }
      toast.success("Employee details updated");
      setIsEditing(false);
      fetchEmployeeData();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save employee");
    } finally {
      setSaving(false);
    }
  };

  const handleClearDeviceLock = async () => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ device_lock_id: null })
        .eq("id", employeeId);

      if (error) throw error;
      toast.success("Device lock cleared successfully");
      fetchEmployeeData();
    } catch (err: any) {
      toast.error(err.message || "Failed to clear device lock");
    }
  };

  const handleDeviceStatusChange = async (deviceId: string, status: 'approved' | 'blocked' | 'pending') => {
    try {
      const { error } = await supabase
        .from("employee_devices")
        .update({ status })
        .eq("id", deviceId);

      if (error) throw error;
      toast.success(`Device ${status}`);
      fetchEmployeeData();
    } catch (err: any) {
      toast.error("Failed to update device status");
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!confirm("Remove this device from registered devices?")) return;
    try {
      const { error } = await supabase
        .from("employee_devices")
        .delete()
        .eq("id", deviceId);

      if (error) throw error;
      toast.success("Device removed");
      fetchEmployeeData();
    } catch (err: any) {
      toast.error("Failed to remove device");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!employee) return null;

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.push("/team/employees")} className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{employee.full_name || "Employee Profile"}</h1>
              <Badge className={employee.status === "active" ? "bg-emerald-600 text-white shadow-sm border-transparent font-medium capitalize" : "bg-red-600 text-white shadow-sm border-transparent font-medium capitalize"}>
                {employee.status || "active"}
              </Badge>
              {employee.account_role === "admin" && (
                <Badge className="bg-amber-600 text-white shadow-sm border-transparent font-medium">System Admin</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {employee.email} {employee.employee_code && `• ID: ${employee.employee_code}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} className="gap-2">
              <Edit2 className="w-4 h-4" />
              Edit Employee
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button onClick={handleSaveEmployee} disabled={saving} className="gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Basic Details & Business Roles */}
        <div className="lg:col-span-2 space-y-8">
          <Card className="p-6 border-border shadow-sm">
            <h2 className="text-lg font-semibold text-foreground mb-4">Business Information</h2>
            
            {!isEditing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Full Name</span>
                  <p className="font-medium text-foreground text-base">{employee.full_name || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Employee ID / Code</span>
                  <p className="font-medium text-foreground text-base">{employee.employee_code || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Email Address (Login ID)</span>
                  <p className="font-medium text-foreground text-base">{employee.email}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Mobile Number</span>
                  <p className="font-medium text-foreground text-base">{employee.mobile || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Department</span>
                  <p className="font-medium text-foreground text-base">{employee.department || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Designation</span>
                  <p className="font-medium text-foreground text-base">{employee.designation || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Assigned Business Role</span>
                  <p className="font-medium text-primary text-base">
                    {employee.employee_roles?.name || "No Business Role Assigned"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">System Account Role</span>
                  <p className="font-medium text-foreground capitalize text-base">{employee.account_role || "member"}</p>
                </div>
                {customFields.map((field) => (
                  <div key={field.id}>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">
                      {field.field_name}
                    </span>
                    <p className="font-medium text-foreground text-base">
                      {customValues[field.id] || "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} placeholder="Full Name" />
                  </div>
                  <div className="space-y-2">
                    <Label>Employee ID / Code</Label>
                    <Input value={form.employee_code} onChange={e => setForm({...form, employee_code: e.target.value})} placeholder="e.g. EMP-001" />
                  </div>
                  <div className="space-y-2">
                    <Label>Mobile Number</Label>
                    <Input value={form.mobile} onChange={e => setForm({...form, mobile: e.target.value})} placeholder="+1 234 567 8900" />
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Input value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder="e.g. Sales" />
                  </div>
                  <div className="space-y-2">
                    <Label>Designation</Label>
                    <Input value={form.designation} onChange={e => setForm({...form, designation: e.target.value})} placeholder="e.g. Field Executive" />
                  </div>
                  <div className="space-y-2">
                    <Label>Business Role</Label>
                    <Select value={form.employee_role_id} onValueChange={v => setForm({...form, employee_role_id: v || ""})}>
                      <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>System Role</Label>
                    <Select value={form.account_role} onValueChange={v => setForm({...form, account_role: v || "member"})}>
                      <SelectTrigger><SelectValue placeholder="Select account role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account Status</Label>
                    <Select value={form.status} onValueChange={v => setForm({...form, status: v || "active"})}>
                      <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {customFields.length > 0 && (
                  <div className="pt-4 border-t border-border mt-4">
                    <CustomFieldsSectionRenderer
                      accountId={accountId || ""}
                      moduleName="user"
                      customFields={customFields}
                      customValues={customValues}
                      onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
                    />
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Quick Shortcuts */}
          <Card className="p-6 border-border shadow-sm">
            <h2 className="text-lg font-semibold text-foreground mb-4">Location & Attendance</h2>
            <div className="flex flex-wrap gap-4">
              <Link href={`/location-tracking/attendance`}>
                <Button variant="outline" className="gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  View Attendance History
                </Button>
              </Link>
              <Link href={`/location-tracking/all-locations`}>
                <Button variant="outline" className="gap-2">
                  <RefreshCw className="w-4 h-4 text-primary" />
                  Live Location Feed
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Right Col: Devices & Login Controls */}
        <div className="space-y-8">
          <Card className="p-6 border-border shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" />
                Registered Devices
              </h2>
              {employee.device_lock_id && (
                <Button variant="outline" size="sm" onClick={handleClearDeviceLock} className="text-xs">
                  <Unlock className="w-3.5 h-3.5 mr-1" />
                  Clear Lock
                </Button>
              )}
            </div>

            {devices.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No devices registered for this employee yet.
              </div>
            ) : (
              <div className="space-y-4">
                {devices.map(device => (
                  <div key={device.id} className="p-4 rounded-lg bg-muted/40 border border-border flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-sm flex items-center gap-2 text-foreground">
                        {device.device_name || "Unknown Device"}
                        <Badge className={
                          device.status === 'approved' ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] uppercase font-bold' :
                          device.status === 'blocked' ? 'bg-red-600 text-white shadow-sm border-transparent text-[10px] uppercase font-bold' :
                          'bg-amber-600 text-white shadow-sm border-transparent text-[10px] uppercase font-bold'
                        }>
                          {device.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        ID: {device.device_id?.slice(0, 16)}...
                      </p>
                      {device.last_seen_at && (
                        <p className="text-[11px] text-muted-foreground">
                          Last active: {new Date(device.last_seen_at).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {device.status !== 'approved' && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeviceStatusChange(device.id, 'approved')} title="Approve device">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        </Button>
                      )}
                      {device.status !== 'blocked' && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeviceStatusChange(device.id, 'blocked')} title="Block device">
                          <XCircle className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteDevice(device.id)} title="Remove device">
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
  ArrowLeft, Edit2, Loader2, Save, Trash2, Smartphone, Lock, Unlock, CheckCircle2, XCircle, Camera, User
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { ensureDefaultSectionsAndFields } from "@/lib/custom-fields";
import { Timeline } from "@/components/shared/timeline";
import { logModuleActivity } from "@/lib/activities";
import type { Employee, EmployeeRole, EmployeeDevice, CustomField } from "@/types";

function AvatarUploader({ url, onUpload, isEditing }: { url?: string | null; onUpload: (url: string) => void; isEditing: boolean }) {
  const [uploading, setUploading] = useState(false);
  const supabase = createClient();

  const handleUpload = async (event: any) => {
    try {
      setUploading(true);
      const file = event.target.files[0];
      if (!file) return;

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage.from('profile_avatars').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('profile_avatars').getPublicUrl(filePath);
      onUpload(data.publicUrl);
    } catch (error: any) {
      toast.error(error.message || "Error uploading image");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-4 w-full justify-center">
      <div className="relative h-32 w-32 rounded-full overflow-hidden border-4 border-muted bg-muted/50 flex items-center justify-center">
        {url ? (
          <img src={url} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <User className="h-12 w-12 text-muted-foreground" />
        )}
        {isEditing && (
          <label className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
            {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{isEditing ? "Click to upload a new profile picture" : "Profile Picture"}</p>
    </div>
  );
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const { user, accountId, isSuperadmin, accountRole } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [devices, setDevices] = useState<EmployeeDevice[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);

  // Edit form state for core fields
  const [form, setForm] = useState({
    full_name: "",
    employee_code: "",
    email: "",
    mobile: "",
    department: "",
    employee_role_id: "",
    manager_id: "",
    status: "active",
    avatar_url: "",
    password: "", // Only populated when Admin resets
    repassword: ""
  });

  const fetchEmployeeData = useCallback(async () => {
    setLoading(true);
    try {
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
        employee_role_id: empData.employee_role_id || "",
        manager_id: empData.manager_id || "",
        status: empData.status || "active",
        avatar_url: empData.avatar_url || "",
        password: "",
        repassword: ""
      });

      const { data: rolesData } = await supabase.from("employee_roles").select("*").order("name", { ascending: true });
      if (rolesData) setRoles(rolesData as EmployeeRole[]);

      const { data: devData } = await supabase.from("employee_devices").select("*").eq("profile_id", employeeId).order("last_seen_at", { ascending: false });
      if (devData) setDevices(devData as EmployeeDevice[]);
      else {
        // Try fallback to user_id if profile_id fails (older DB schema)
        const { data: devDataLegacy } = await supabase.from("employee_devices").select("*").eq("user_id", employeeId).order("last_login", { ascending: false });
        if (devDataLegacy) setDevices(devDataLegacy as EmployeeDevice[]);
      }

      if (accountId && user?.id) {
        await ensureDefaultSectionsAndFields(accountId, "user", user.id, supabase);
      }

      const { data: fieldsData } = await supabase.from("custom_fields").select("*").eq("module_name", "user").order("created_at");
      if (fieldsData) setCustomFields(fieldsData);

      const { data: cvData } = await supabase.from("user_custom_values").select("*").eq("user_id", employeeId);
      if (cvData) {
        const vals: Record<string, string> = {};
        cvData.forEach((row: any) => { vals[row.custom_field_id] = row.value; });
        setCustomValues(vals);
      } else {
        setCustomValues({});
      }

      // Fetch Timeline
      const { data: timelineActs } = await supabase.from("module_activities").select("*").eq("module_name", "user").eq("record_id", employeeId).order("created_at", { ascending: false });
      if (timelineActs) setActivities(timelineActs);
      
      const { data: timelineTasks } = await supabase.from("tasks").select("*").eq("module_name", "user").eq("record_id", employeeId).order("created_at", { ascending: false });
      if (timelineTasks) setTasks(timelineTasks);

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
    if (form.password && form.password !== form.repassword) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const selectedRole = roles.find((r) => r.id === form.employee_role_id);
      const derivedAccountRole = employee?.account_role === "owner" ? "owner" : selectedRole?.permissions?.all === true ? "admin" : "agent";

      const updates: any = {
        full_name: form.full_name.trim(),
        employee_code: form.employee_code.trim() || null,
        mobile: form.mobile.trim() || null,
        department: form.department.trim() || null,
        employee_role_id: form.employee_role_id || null,
        manager_id: form.manager_id || null,
        account_role: derivedAccountRole,
        status: form.status,
        avatar_url: form.avatar_url || null
      };
      if (form.password) {
        updates.password = form.password;
        updates.repassword = form.repassword;
      }

      const res = await fetch("/api/team/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: employeeId,
          updates
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update profile");

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

      if (employee?.status !== form.status) {
        await logModuleActivity(supabase, {
          moduleName: 'user',
          recordId: employeeId as string,
          action: 'status_updated',
          message: `Employee status changed to ${form.status}`
        });
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

  const handleDeviceStatusChange = async (deviceId: string, status: 'approved' | 'blocked' | 'pending') => {
    try {
      const { error } = await supabase.from("employee_devices").update({ status }).eq("id", deviceId);
      if (error) throw error;
      toast.success(`Device ${status}`);
      fetchEmployeeData();
    } catch (err: any) {
      toast.error("Failed to update device status");
    }
  };

  const renderCustomSystemField = (field: CustomField) => {
    if (!field.system_key) return null;

    if (!isEditing) {
      let val = form[field.system_key as keyof typeof form] || "—";
      if (field.system_key === 'password' || field.system_key === 'repassword') return null; // hide entirely in read mode
      if (field.system_key === 'employee_role_id') val = roles.find(r => r.id === form.employee_role_id)?.name || "—";
      return (
        <p className="font-medium text-foreground text-base capitalize">{val}</p>
      );
    }

    const key = field.system_key as keyof typeof form;
    
    if (key === 'employee_role_id') {
      return (
        <Select value={form.employee_role_id} onValueChange={v => setForm({...form, employee_role_id: v || ""})}>
          <SelectTrigger>
            <SelectValue placeholder="Select a role">
              {form.employee_role_id ? roles.find(r => r.id === form.employee_role_id)?.name || "Select a role" : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }

    if (key === 'status') {
      return (
        <RadioGroup value={form.status} onValueChange={(v) => setForm({...form, status: v})} className="flex flex-col space-y-1">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="active" id="status-active" />
            <Label htmlFor="status-active" className="cursor-pointer font-normal">Active</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="inactive" id="status-inactive" />
            <Label htmlFor="status-inactive" className="cursor-pointer font-normal">Inactive</Label>
          </div>
        </RadioGroup>
      );
    }

    if (key === 'password' || key === 'repassword') {
      const isAdmin = accountRole === 'admin' || accountRole === 'owner' || isSuperadmin;
      if (!isAdmin) return null;
      return (
        <Input type="password" value={form[key] as string} onChange={e => setForm({...form, [key]: e.target.value})} placeholder={key === 'password' ? "Reset Password..." : "Re-enter Password..."} />
      );
    }

    return (
      <Input type={field.field_type === 'email' ? 'email' : 'text'} value={form[key] as string} onChange={e => setForm({...form, [key]: e.target.value})} />
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
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
              <Badge className={employee.status === "active" ? "bg-emerald-600 text-white shadow-sm border-transparent" : "bg-red-600 text-white shadow-sm border-transparent"}>
                {employee.status || "active"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {employee.email} {employee.employee_code && `• ID: ${employee.employee_code}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} className="gap-2"><Edit2 className="w-4 h-4" />Edit Employee</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
              <Button onClick={handleSaveEmployee} disabled={saving} className="gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" /> Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Details & Devices */}
        <div className="lg:col-span-2 space-y-8">
          <Card className="p-6 border-border shadow-sm">
            <AvatarUploader url={form.avatar_url} onUpload={(url) => setForm({...form, avatar_url: url})} isEditing={isEditing} />
            <CustomFieldsSectionRenderer
              accountId={accountId || ""}
              moduleName="user"
              customFields={customFields}
              customValues={customValues}
              onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
              renderCustomSystemField={renderCustomSystemField}
              isEditing={isEditing} // We'll need to patch CustomFieldsSectionRenderer for this prop if missing, but it handles inputs normally. Wait, CustomFieldsSectionRenderer always renders Inputs. I will need to patch it or just handle it.
            />
          </Card>

          <Card className="border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" /> User Devices
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 font-medium">Device Name</th>
                    <th className="px-4 py-3 font-medium">Device ID</th>
                    <th className="px-4 py-3 font-medium">Application Version</th>
                    <th className="px-4 py-3 font-medium">Database Version</th>
                    <th className="px-4 py-3 font-medium">Last Active Session</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {devices.map(device => (
                    <tr key={device.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{device.device_name || "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{device.device_id || "-"}</td>
                      <td className="px-4 py-3">{device.application_version || "-"}</td>
                      <td className="px-4 py-3">{device.database_version || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {device.last_seen_at || device.last_login ? new Date(device.last_seen_at || device.last_login!).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={
                          device.status === 'approved' ? 'bg-emerald-600' :
                          device.status === 'blocked' ? 'bg-red-600' : 'bg-amber-600'
                        }>{device.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {device.status !== 'blocked' && (
                          <Button variant="secondary" size="sm" onClick={() => handleDeviceStatusChange(device.id, 'blocked')}>INACTIVATE</Button>
                        )}
                        {device.status === 'blocked' && (
                          <Button variant="outline" size="sm" onClick={() => handleDeviceStatusChange(device.id, 'approved')}>ACTIVATE</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {devices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No devices registered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right Col: Timeline */}
        <div className="space-y-8">
          <Timeline 
            moduleName="user"
            recordId={employeeId}
            tasks={tasks}
            activities={activities}
            notes={notes}
            onRefresh={fetchEmployeeData}
          />
        </div>
      </div>
    </div>
  );
}

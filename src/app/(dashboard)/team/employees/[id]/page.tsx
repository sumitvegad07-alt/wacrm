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
  ArrowLeft, Edit2, Loader2, Save, Trash2, Smartphone, Lock, Unlock, CheckCircle2, XCircle, Camera, User, MapPin, CalendarDays
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { ensureDefaultSectionsAndFields } from "@/lib/custom-fields";
import { Timeline } from "@/components/shared/timeline";
import { EmployeeRouteTab } from "@/components/territories/employee-route-tab";
import { EmployeeAreaAssignment } from "@/components/territories/employee-area-assignment";
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

  const { user, accountId, isSuperadmin, accountRole, isModuleEnabled } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [devices, setDevices] = useState<EmployeeDevice[]>([]);
  const [holidayLists, setHolidayLists] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  // Other employees, for the Reporting Manager picker (only used when Reporting Hierarchy is on).
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "territory" | "routes">("details");
  
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
    holiday_list_id: "",
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
        holiday_list_id: empData.holiday_list_id || "",
        status: empData.status || "active",
        avatar_url: empData.avatar_url || "",
        password: "",
        repassword: ""
      });

      const { data: rolesData } = await supabase.from("employee_roles").select("*").order("name", { ascending: true });
      if (rolesData) setRoles(rolesData as EmployeeRole[]);

      // employee_devices has neither `last_seen_at` nor `user_id` — ordering/filtering by them
      // made BOTH the primary and the "legacy fallback" query 400, so this table always rendered
      // empty even though device rows exist. Scope by profile_id and order by last_login.
      const { data: devData, error: devErr } = await supabase
        .from("employee_devices")
        .select("*")
        .eq("profile_id", employeeId)
        .order("last_login", { ascending: false, nullsFirst: false });
      if (devErr) console.error("[employee] failed to load devices:", devErr);

      const { data: listData } = await supabase
        .from("holiday_lists")
        .select("id, name, is_default")
        .order("name");
      setHolidayLists(listData ?? []);
      setDevices((devData || []) as EmployeeDevice[]);

      // Manager options for the reporting hierarchy — everyone else in the account (never self, to
      // keep a person from being their own manager; the DB also blocks cycles).
      const { data: mgrData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .neq("id", employeeId)
        .order("full_name");
      setManagers((mgrData ?? []) as { id: string; full_name: string }[]);

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
      
      // NOTE: no task query here. `tasks` has no module_name/record_id columns (it links to a
      // module via dedicated FKs: contact_id, lead_id, deal_id, order_id, ...) and has no
      // employee/profile link at all, so the old .eq("module_name","user") query 400'd on every
      // load and never returned anything. Removed rather than left failing; re-add if/when
      // tasks can actually be attached to an employee.
      setTasks([]);

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
        // Empty means "follow the account default", which is a NULL assignment, not a blank id.
        holiday_list_id: form.holiday_list_id || null,
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

      const message = employee?.status !== form.status 
        ? `Employee details updated (Status changed to ${form.status})` 
        : `Employee details updated`;

      await logModuleActivity(supabase, {
        moduleName: 'user',
        recordId: employeeId as string,
        action: 'updated',
        message
      });

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

  // The real employee_devices.status values are 'pending' | 'active' | 'rejected' | 'inactive'.
  // This screen previously wrote/compared 'approved'/'blocked', which matched no real row — the
  // badge fell through to the amber default and the buttons wrote statuses nothing else reads.
  const handleDeviceStatusChange = async (deviceId: string, status: 'active' | 'inactive' | 'rejected' | 'pending') => {
    try {
      const { error } = await supabase.from("employee_devices").update({ status }).eq("id", deviceId);
      if (error) throw error;
      toast.success(`Device ${status}`);
      fetchEmployeeData();
    } catch (err: any) {
      toast.error("Failed to update device status");
    }
  };

  const defaultHolidayList = holidayLists.find((l) => l.is_default);
  const defaultHolidayListLabel = defaultHolidayList
    ? `Company default (${defaultHolidayList.name})`
    : "Company default";

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

      {/* Tab bar — Details | Territory Assignment | Route Management */}
      <div className="flex items-center gap-1 border-b border-border -mt-2">
        {([
          { key: "details", label: "Details" },
          { key: "territory", label: "Territory Assignment" },
          ...(isModuleEnabled("route") ? [{ key: "routes" as const, label: "Route Management" }] : []),
        ] as { key: "details" | "territory" | "routes"; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {activeTab === "territory" && accountId && (
        <EmployeeAreaAssignment
          employeeId={employeeId}
          accountId={accountId}
          canEdit={accountRole === "owner" || accountRole === "admin" || isSuperadmin}
        />
      )}

      {activeTab === "routes" && accountId && (
        <EmployeeRouteTab employeeId={employeeId} accountId={accountId} />
      )}

      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-8 ${activeTab === "details" ? "" : "hidden"}`}>
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
                <CalendarDays className="w-5 h-5 text-primary" /> Holiday List
              </h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Decides this employee&apos;s weekly offs and holidays. Leave taken across those days
                is not counted, and the attendance page judges them against this calendar.
              </p>
              {isEditing ? (
                <Select
                  value={form.holiday_list_id || "__default__"}
                  items={Object.fromEntries([
                    ["__default__", defaultHolidayListLabel],
                    ...holidayLists.map((l) => [l.id, l.name] as [string, string]),
                  ])}
                  onValueChange={(v) =>
                    setForm({ ...form, holiday_list_id: v === "__default__" ? "" : (v ?? "") })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* "Follow the default" is a real choice, not an empty one — picking it means
                        the employee tracks whatever the company default becomes later. */}
                    <SelectItem value="__default__">{defaultHolidayListLabel}</SelectItem>
                    {holidayLists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="font-medium text-foreground text-base">
                  {holidayLists.find((l) => l.id === form.holiday_list_id)?.name ??
                    defaultHolidayListLabel}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {isEditing
                  ? "Saved when you press Save."
                  : "Press Edit to change which calendar this employee follows."}{" "}
                Lists are built in <strong>Settings → Leave Settings → Holiday Lists</strong>.
              </p>
            </div>
          </Card>

          {/* Reporting Manager — only when Reporting Hierarchy is enabled in Organisation Settings.
              Sets profiles.manager_id, which drives the View Subordinate/Manager Data rights. */}
          {isModuleEnabled("reporting_hierarchy") && (
            <Card className="border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/20">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" /> Reporting Manager
                </h2>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Who this employee reports to. Sets the reporting hierarchy that the
                  &ldquo;View Subordinate / Manager Data&rdquo; rights walk.
                </p>
                {isEditing ? (
                  <Select
                    value={form.manager_id || "__none__"}
                    items={Object.fromEntries([
                      ["__none__", "— No manager —"],
                      ...managers.map((m) => [m.id, m.full_name] as [string, string]),
                    ])}
                    onValueChange={(v) =>
                      setForm({ ...form, manager_id: v === "__none__" ? "" : (v ?? "") })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No manager —</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="font-medium text-foreground text-base">
                    {managers.find((m) => m.id === form.manager_id)?.full_name ?? "— No manager —"}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card className="border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" /> User Devices
              </h2>
            </div>
            {/* Card list rather than a wide table: the 7-column table pushed the
                Activate/Inactivate action off-screen, so approving a device meant scrolling
                sideways to find the button. Here the action is always in view. */}
            <div className="divide-y divide-border">
              {devices.map(device => (
                <div key={device.id} className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{device.device_name || "Unknown device"}</span>
                      <Badge className={
                        device.status === 'active' ? 'bg-emerald-600' :
                        device.status === 'rejected' ? 'bg-red-600' :
                        device.status === 'inactive' ? 'bg-slate-600' : 'bg-amber-600'
                      }>{device.status}</Badge>
                      {device.status === 'pending' && (
                        <span className="text-xs text-amber-500">waiting for your approval</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {device.os || "Unknown OS"}
                      {device.application_version ? ` · app ${device.application_version}` : ""}
                      {device.database_version ? ` · db ${device.database_version}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Last active: {device.last_login ? new Date(device.last_login).toLocaleString() : "never"}
                      {device.device_id ? ` · ID ${String(device.device_id).slice(0, 12)}…` : ""}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {device.status === 'active' ? (
                      <Button variant="secondary" size="sm" onClick={() => handleDeviceStatusChange(device.id, 'inactive')}>
                        Inactivate
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => handleDeviceStatusChange(device.id, 'active')}>
                          {device.status === 'pending' ? 'Approve' : 'Activate'}
                        </Button>
                        {device.status === 'pending' && (
                          <Button variant="outline" size="sm" onClick={() => handleDeviceStatusChange(device.id, 'rejected')}>
                            Reject
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {devices.length === 0 && (
                <p className="px-4 py-8 text-center text-muted-foreground">No devices registered.</p>
              )}
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

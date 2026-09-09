"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { UserPlus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { ensureDefaultSectionsAndFields } from "@/lib/custom-fields";
import { FormPageShell, FormActions, PhotoUpload } from "@/components/shared";
import type { EmployeeRole, CustomField } from "@/types";
import { TerritoryPicker } from "@/components/territories/territory-picker";
import { getTerritoryRows, getAccountTerritorySettings, assignEmployeeAreas } from "@/lib/territories/api";
import type { Territory, TerritorySettings } from "@/lib/territories/types";
import { DEFAULT_TERRITORY_SETTINGS } from "@/lib/territories/settings";

export default function NewEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const { accountId, user } = useAuth();
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  // Territory Master area assignment. The legacy free-text "area" system field is
  // replaced in the form by the real cascade picker (Country → State → City), and
  // the chosen leaf territory is saved as an employee_area_assignment on submit.
  const [territoryRows, setTerritoryRows] = useState<Territory[]>([]);
  const [territorySettings, setTerritorySettings] = useState<TerritorySettings>(DEFAULT_TERRITORY_SETTINGS);
  const [areaTerritoryId, setAreaTerritoryId] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    repassword: "",
    employee_code: "",
    mobile: "",
    department: "",
    employee_role_id: "",
    status: "active",
    avatar_url: "",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!accountId || !user?.id) return;
      
      const { data } = await supabase
        .from("employee_roles")
        .select("*")
        .order("name", { ascending: true });
      if (data) setRoles(data as EmployeeRole[]);

      await ensureDefaultSectionsAndFields(accountId, "user", user.id, supabase);

      const { data: fieldsData } = await supabase
        .from("custom_fields")
        .select("*")
        .eq("module_name", "user")
        .order("created_at");
      if (fieldsData) setCustomFields(fieldsData);

      // Territory data for the area picker (same source as Company Profile).
      try {
        const [rows, settings] = await Promise.all([
          getTerritoryRows(accountId),
          getAccountTerritorySettings(accountId),
        ]);
        setTerritoryRows(rows);
        setTerritorySettings(settings);
      } catch {
        // Non-fatal — the picker just shows no options if territories can't load.
      }

      setLoading(false);
    }
    loadData();
  }, [supabase, accountId, user?.id]);

  const handleCreateEmployee = async () => {
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Please fill in all required fields (Name, Email, Password)");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }
    if (form.password !== form.repassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!form.employee_role_id) {
      toast.error("Please select an employee role");
      return;
    }

    setCreating(true);
    try {
      const selectedRole = roles.find((r) => r.id === form.employee_role_id);
      const account_role = selectedRole?.permissions?.all === true ? "admin" : "agent";

      const res = await fetch("/api/team/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          email: form.email.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          employee_code: form.employee_code.trim() || undefined,
          mobile: form.mobile.trim() || undefined,
          department: form.department.trim() || undefined,
          employee_role_id: form.employee_role_id || undefined,
          status: form.status,
          account_role,
          avatar_url: form.avatar_url || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create employee account");
      }

      const profileId: string | undefined = data.profile?.id;
      if (profileId && Object.keys(customValues).length > 0) {
        const toInsert = Object.entries(customValues)
          .filter(([_, val]) => val !== undefined && val !== '')
          .map(([fieldId, val]) => ({
            account_id: accountId,
            user_id: profileId,
            custom_field_id: fieldId,
            value: val
          }));
        if (toInsert.length > 0) {
          await supabase.from("user_custom_values").insert(toInsert);
        }
      }

      // Assign the picked Territory Master area to the new employee. Non-blocking:
      // the account is already created, so a failure here only warns.
      if (profileId && areaTerritoryId) {
        try {
          const res = (await assignEmployeeAreas(profileId, [areaTerritoryId])) as {
            ok: boolean; reason?: string; territory_name?: string;
          };
          if (!res.ok && res.reason === "area_taken") {
            toast.warning(
              `Employee created, but "${res.territory_name}" is already owned by another employee (area-wise mode allows one owner per area). Assign a different area from their Territory tab.`
            );
          }
        } catch {
          toast.warning("Employee created, but the area assignment could not be saved. Set it from their Territory tab.");
        }
      }

      toast.success("Employee created successfully!");
      router.push(profileId ? `/team/employees/${profileId}` : "/team/employees");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create employee account");
    } finally {
      setCreating(false);
    }
  };

  const renderCustomSystemField = (field: CustomField) => {
    if (!field.system_key) return null;
    const key = field.system_key as keyof typeof form;

    // Geography (area + country/state/city) is captured once by the full-width
    // Territory cascade rendered below the grid — hide the crammed per-cell
    // versions here so the form isn't a row of squished dropdowns and duplicate
    // plain text fields (which were never even saved).
    if (['area', 'country', 'state', 'city'].includes(field.system_key)) {
      return null;
    }

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
      return (
        <Input type="password" value={form[key] as string} onChange={e => setForm({...form, [key]: e.target.value})} placeholder={key === 'password' ? "Enter Password..." : "Re-enter Password..."} />
      );
    }

    return (
      <Input type={field.field_type === 'email' ? 'email' : 'text'} value={form[key] as string} onChange={e => setForm({...form, [key]: e.target.value})} placeholder={`Enter ${field.field_name}...`} />
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <FormPageShell
      icon={UserPlus}
      title="Add New Employee"
      subtitle="Create login credentials and assign an employee role."
      onBack={() => router.push("/team/employees")}
      footer={
        <FormActions
          onCancel={() => router.push("/team/employees")}
          onSave={handleCreateEmployee}
          saving={creating}
          saveLabel="Create Employee"
        />
      }
    >
      <div className="space-y-8">
        {/* Image is always the first field of the form. */}
        <PhotoUpload
          label="Profile Picture"
          value={form.avatar_url}
          onChange={(url) => setForm({ ...form, avatar_url: url })}
          bucket="profile_avatars"
          fallback={form.full_name || "U"}
          shape="circle"
        />

        <CustomFieldsSectionRenderer
          accountId={accountId || ""}
          moduleName="user"
          fieldGridClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4"
          customFields={customFields}
          customValues={customValues}
          onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
          renderCustomSystemField={renderCustomSystemField}
          isEditing={true}
        />

        {/* Geography, once, full-width — the Country → State → City cascade that
            also gets assigned as the employee's territory on save. */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground border-b border-border pb-1.5">
            Assigned Area
          </h4>
          <TerritoryPicker
            rows={territoryRows}
            settings={territorySettings}
            value={areaTerritoryId}
            onChange={(id) => setAreaTerritoryId(id)}
          />
        </div>
      </div>
    </FormPageShell>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { ensureDefaultSectionsAndFields } from "@/lib/custom-fields";
import type { EmployeeRole, CustomField } from "@/types";

export default function NewEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const { accountId, user, isSuperadmin, accountRole: authRole } = useAuth();
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
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
      
      setLoading(false);
    }
    loadData();
  }, [supabase, accountId, user?.id]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
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
    
    if (key === 'employee_role_id') {
      return (
        <Select value={form.employee_role_id} onValueChange={v => setForm({...form, employee_role_id: v || ""})}>
          <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
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
    <div className="p-8 w-full max-w-none space-y-8">
      <div className="flex items-center justify-between pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <Link href="/team/employees">
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <UserPlus className="w-6 h-6 text-primary" />
              Add New Employee
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create login credentials and assign an employee role.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreateEmployee} className="space-y-8">
        <Card className="p-6 border-border shadow-sm">
          <CustomFieldsSectionRenderer
            accountId={accountId || ""}
            moduleName="user"
            customFields={customFields}
            customValues={customValues}
            onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
            renderCustomSystemField={renderCustomSystemField}
            isEditing={true}
          />
        </Card>

        <div className="flex items-center justify-end gap-4 pt-4">
          <Link href="/team/employees">
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={creating} className="min-w-[150px]">
            {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Employee
          </Button>
        </div>
      </form>
    </div>
  );
}

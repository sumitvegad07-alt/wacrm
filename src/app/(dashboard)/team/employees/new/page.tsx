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
import { ArrowLeft, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import type { EmployeeRole, CustomField } from "@/types";

export default function NewEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const { accountId } = useAuth();
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    employee_code: "",
    mobile: "",
    department: "",
    employee_role_id: "",
  });

  useEffect(() => {
    async function loadRoles() {
      const { data } = await supabase
        .from("employee_roles")
        .select("*")
        .order("name", { ascending: true });
      if (data) setRoles(data as EmployeeRole[]);
      const { data: fieldsData } = await supabase
        .from("custom_fields")
        .select("*")
        .eq("module_name", "user")
        .order("created_at");
      if (fieldsData) setCustomFields(fieldsData);
    }
    loadRoles();
  }, [supabase]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Please fill in all required fields (*)");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    if (!form.employee_role_id) {
      toast.error("Please select an employee role");
      return;
    }

    setCreating(true);
    try {
      // One role: the security level (account_role) is derived from whether the
      // chosen Employee Role has Full Access — admins never pick a system role.
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

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {/* Top Header */}
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
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Basic Information & Credentials</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                placeholder="e.g. John Doe"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="employee_code">Employee ID / Code</Label>
              <Input
                id="employee_code"
                value={form.employee_code}
                onChange={e => setForm({ ...form, employee_code: e.target.value })}
                placeholder="e.g. EMP-001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Login ID *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="e.g. ramesh.sales@company.com"
                required
              />
              <p className="text-xs text-muted-foreground">
                Used to sign in. Must be in email format, but it does <strong>not</strong> have to be a real, working inbox.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="text"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="********"
                required
              />
              <p className="text-xs text-muted-foreground">At least 6 characters required.</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Role & Organization Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Employee Role *</Label>
              <Select
                value={form.employee_role_id}
                onValueChange={v => setForm({ ...form, employee_role_id: v || "" })}
                items={Object.fromEntries(roles.map(r => [r.id, r.name]))}
              >
                <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The role decides this employee&apos;s rights. A role with Full Access makes them an admin.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mobile">Mobile Number</Label>
              <Input
                id="mobile"
                value={form.mobile}
                onChange={e => setForm({ ...form, mobile: e.target.value })}
                placeholder="+1 234 567 8900"
              />
            </div>
          </div>
        </Card>

        {customFields.length > 0 && (
          <Card className="p-6 border-border shadow-sm">
            <CustomFieldsSectionRenderer
              accountId={accountId || ""}
              moduleName="user"
              customFields={customFields}
              customValues={customValues}
              onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
            />
          </Card>
        )}

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

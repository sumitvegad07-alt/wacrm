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
import type { EmployeeRole } from "@/types";

export default function NewEmployeePage() {
  const router = useRouter();
  const supabase = createClient();

  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    employee_code: "",
    mobile: "",
    department: "",
    designation: "",
    employee_role_id: "",
    account_role: "member"
  });

  useEffect(() => {
    async function loadRoles() {
      const { data } = await supabase
        .from("employee_roles")
        .select("*")
        .order("name", { ascending: true });
      if (data) setRoles(data as EmployeeRole[]);
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

    setCreating(true);
    try {
      const res = await fetch("/api/admin/employees/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          employee_code: form.employee_code.trim() || undefined,
          mobile: form.mobile.trim() || undefined,
          department: form.department.trim() || undefined,
          designation: form.designation.trim() || undefined,
          employee_role_id: form.employee_role_id || undefined,
          account_role: form.account_role || "member"
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create employee account");
      }

      toast.success("Employee created successfully!");
      if (data.user?.id) {
        router.push(`/team/employees/${data.user.id}`);
      } else {
        router.push("/team/employees");
      }
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
              Create login credentials and assign business & system roles to an employee.
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
              <Label htmlFor="email">Email Address (Login ID) *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="john@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Temporary Password *</Label>
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
              <Label>Business Role *</Label>
              <Select value={form.employee_role_id} onValueChange={v => setForm({ ...form, employee_role_id: v || "" })}>
                <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>System Account Role</Label>
              <Select value={form.account_role} onValueChange={v => setForm({ ...form, account_role: v || "member" })}>
                <SelectTrigger><SelectValue placeholder="Select account role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
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

            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
                placeholder="e.g. Sales"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="designation">Designation</Label>
              <Input
                id="designation"
                value={form.designation}
                onChange={e => setForm({ ...form, designation: e.target.value })}
                placeholder="e.g. Field Executive"
              />
            </div>
          </div>
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

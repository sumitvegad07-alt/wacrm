"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, UserPlus, Loader2, Upload, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
    avatar_url: "",
  });
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleUploadImage = async (event: any) => {
    try {
      setUploadingImage(true);
      const file = event.target.files?.[0];
      if (!file) return;

      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        toast.error('Unsupported image type. Use PNG, JPG, WebP, or GIF.');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Image is too large. Maximum 2 MB.');
        return;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage.from('profile_avatars').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('profile_avatars').getPublicUrl(filePath);
      setForm({ ...form, avatar_url: data.publicUrl });
    } catch (error: any) {
      toast.error(error.message || "Error uploading image");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
        <Card className="p-6 border-border shadow-sm space-y-6">
          <div className="flex flex-col gap-4">
            <Label className="text-base font-semibold">Profile Picture</Label>
            <div className="flex flex-col sm:flex-row sm:items-start gap-6">
              <Avatar className="h-24 w-24 rounded-lg border border-border shadow-sm">
                {form.avatar_url ? (
                  <AvatarImage src={form.avatar_url} className="object-cover" />
                ) : (
                  <AvatarFallback className="rounded-lg text-3xl font-medium bg-muted text-muted-foreground">
                    {form.full_name ? form.full_name.charAt(0).toUpperCase() : 'U'}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}>
                    {uploadingImage ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Upload Photo
                  </Button>
                  {form.avatar_url && (
                    <Button type="button" variant="destructive" size="sm" onClick={() => setForm({...form, avatar_url: ""})} disabled={uploadingImage}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended size: 256x256px.<br />
                  Max file size: 2MB.
                </p>
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleUploadImage}
              disabled={uploadingImage}
            />
          </div>
        </Card>

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

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

export default function NewAnnouncementPage() {
  const { accountId } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  
  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date>();
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeRoleIds, setEmployeeRoleIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    async function loadLookups() {
      if (!accountId) return;
      const [{ data: empData }, { data: roleData }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("account_id", accountId),
        supabase.from("employee_roles").select("id, name").eq("account_id", accountId),
      ]);
      setEmployees(empData || []);
      setRoles(roleData || []);
    }
    loadLookups();
  }, [accountId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and Content are required");
      return;
    }
    setLoading(true);

    try {
      let attachmentUrl = null;

      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${accountId}/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from("announcements")
          .upload(filePath, file);
          
        if (uploadError) throw uploadError;
        
        const { data } = supabase.storage.from("announcements").getPublicUrl(filePath);
        attachmentUrl = data.publicUrl;
      }

      const payload: any = {
        account_id: accountId,
        title,
        content,
        expiry_date: expiryDate ? expiryDate.toISOString() : null,
        attachment_url: attachmentUrl,
        employee_ids: employeeIds,
        employee_role_ids: employeeRoleIds,
      };

      const { error } = await supabase.from("tenant_announcements").insert(payload);
      if (error) throw error;

      toast.success("Announcement created successfully");
      router.push("/announcements");
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to create announcement");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title="Create Announcement"
      >
        <p className="text-sm text-muted-foreground">Write a new announcement for your team.</p>
      </PageHeader>

      <div className="flex flex-col lg:flex-row gap-6 mt-6">
        <div className="flex-1 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <h2 className="text-base font-semibold">Basic Details</h2>
            
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>Expiry Date</Label>
                <Popover>
                  <PopoverTrigger 
                    render={
                      <Button
                        variant="outline"
                        className={cn("justify-start text-left font-normal", !expiryDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {expiryDate ? format(expiryDate, "PPP") : <span>Enter Expiry Date...</span>}
                      </Button>
                    }
                  />
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={expiryDate} onSelect={setExpiryDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>Employee</Label>
                <select
                  multiple
                  value={employeeIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, option => option.value);
                    setEmployeeIds(selected);
                  }}
                  className="flex min-h-[100px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
                <p className="text-[10px] text-muted-foreground">Hold Ctrl/Cmd to select multiple</p>
              </div>
              <div className="space-y-2 flex flex-col">
                <Label>Employee Role</Label>
                <select
                  multiple
                  value={employeeRoleIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, option => option.value);
                    setEmployeeRoleIds(selected);
                  }}
                  className="flex min-h-[100px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <p className="text-[10px] text-muted-foreground">Hold Ctrl/Cmd to select multiple</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 space-y-5 h-full flex flex-col">
            <h2 className="text-base font-semibold">Content <span className="text-destructive">*</span></h2>
            
            <div className="flex-1 min-h-[300px]">
              <RichTextEditor
                value={content}
                onChange={setContent}
                placeholder="Enter Remark..."
                className="h-full"
              />
            </div>
            
            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-4">
                <Label htmlFor="attachment" className="cursor-pointer flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <Upload className="h-4 w-4" />
                  Attach a File <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="attachment"
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {file && (
                  <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full text-xs">
                    <span className="truncate max-w-[200px]">{file.name}</span>
                    <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()}>BACK</Button>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "SAVING..." : "SAVE"}
        </Button>
      </div>
    </PageLayout>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Upload, X, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { MultiSelect } from "@/components/ui/multi-select";

interface AnnouncementFormProps {
  initialData?: any;
}

export function AnnouncementForm({ initialData }: AnnouncementFormProps) {
  const { accountId } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  
  // Form state
  const [title, setTitle] = useState(initialData?.title || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [expiryDate, setExpiryDate] = useState<Date | undefined>(initialData?.expiry_date ? parseISO(initialData.expiry_date) : undefined);
  const [employeeIds, setEmployeeIds] = useState<string[]>(initialData?.employee_ids || []);
  const [employeeRoleIds, setEmployeeRoleIds] = useState<string[]>(initialData?.employee_role_ids || []);
  const [externalLink, setExternalLink] = useState(initialData?.external_link || "");
  const [file, setFile] = useState<File | null>(null);
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(initialData?.attachment_url || null);

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
      setExistingAttachmentUrl(null); // Clear existing if they pick a new one
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and Content are required");
      return;
    }
    setLoading(true);

    try {
      let attachmentUrl = existingAttachmentUrl;

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
        external_link: externalLink || null,
        expiry_date: expiryDate ? expiryDate.toISOString() : null,
        attachment_url: attachmentUrl,
        employee_ids: employeeIds,
        employee_role_ids: employeeRoleIds,
      };

      if (initialData?.id) {
        const { error } = await supabase.from("tenant_announcements").update(payload).eq("id", initialData.id);
        if (error) throw error;
        toast.success("Announcement updated successfully");
      } else {
        const { error } = await supabase.from("tenant_announcements").insert(payload);
        if (error) throw error;
        toast.success("Announcement created successfully");
      }

      router.push("/announcements");
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to save announcement");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-6 mt-6">
        <div className="flex-1 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <h2 className="text-base font-semibold">Basic Details</h2>
            
            <div className="space-y-2">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Announcement Title"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>Expiry Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("justify-start text-left font-normal", !expiryDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {expiryDate ? format(expiryDate, "dd/MM/yyyy") : <span>Select Expiry Date...</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={expiryDate} onSelect={setExpiryDate} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2 flex flex-col">
                <Label>External Link</Label>
                <div className="relative">
                  <LinkIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={externalLink}
                    onChange={(e) => setExternalLink(e.target.value)}
                    placeholder="https://..."
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 flex flex-col">
                <Label>Employee</Label>
                <MultiSelect
                  options={employees.map(e => ({ label: e.full_name, value: e.id }))}
                  selectedValues={employeeIds}
                  onChange={setEmployeeIds}
                  placeholder="All Users (Default)"
                  emptyMessage="No users found."
                />
              </div>
              <div className="space-y-2 flex flex-col">
                <Label>Employee Role</Label>
                <MultiSelect
                  options={roles.map(r => ({ label: r.name, value: r.id }))}
                  selectedValues={employeeRoleIds}
                  onChange={setEmployeeRoleIds}
                  placeholder="All Roles (Default)"
                  emptyMessage="No roles found."
                />
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
                placeholder="Enter announcement details..."
                className="h-full"
              />
            </div>
            
            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-4">
                <Label htmlFor="attachment" className="cursor-pointer flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <Upload className="h-4 w-4" />
                  Attach a File <span className="text-muted-foreground text-xs font-normal">(Optional)</span>
                </Label>
                <Input
                  id="attachment"
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {(file || existingAttachmentUrl) && (
                  <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full text-xs">
                    <span className="truncate max-w-[200px]">
                      {file ? file.name : existingAttachmentUrl?.split('/').pop()}
                    </span>
                    <button onClick={() => { setFile(null); setExistingAttachmentUrl(null); }} className="text-muted-foreground hover:text-foreground">
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
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Announcement"}
        </Button>
      </div>
    </>
  );
}

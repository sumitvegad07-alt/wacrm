"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageLayout, PageHeader } from "@/components/shared";
import { Loader2, ArrowLeft, Link as LinkIcon, Paperclip, Calendar, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function AnnouncementDetailsPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const supabase = createClient();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const { data: announcement, error } = await supabase
        .from("tenant_announcements")
        .select("*")
        .eq("id", id)
        .single();
      
      if (error) {
        toast.error("Failed to load announcement");
        setLoading(false);
        return;
      }
      
      setData(announcement);

      // Load lookup data if targeted
      if (announcement.employee_ids?.length > 0) {
        const { data: empData } = await supabase.from("profiles").select("id, full_name").in("id", announcement.employee_ids);
        const empMap: Record<string, string> = {};
        empData?.forEach(e => { empMap[e.id] = e.full_name; });
        setEmployees(empMap);
      }

      if (announcement.employee_role_ids?.length > 0) {
        const { data: roleData } = await supabase.from("employee_roles").select("id, name").in("id", announcement.employee_role_ids);
        const roleMap: Record<string, string> = {};
        roleData?.forEach(r => { roleMap[r.id] = r.name; });
        setRoles(roleMap);
      }

      setLoading(false);
    }
    if (id) load();
  }, [id, supabase]);

  if (loading) {
    return (
      <PageLayout>
        <div className="flex h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageLayout>
    );
  }

  if (!data) {
    return (
      <PageLayout>
        <div className="flex h-[400px] flex-col items-center justify-center space-y-2">
          <p className="text-xl font-semibold">Announcement not found</p>
          <p className="text-sm text-muted-foreground">The announcement may have been deleted.</p>
          <Button variant="outline" onClick={() => router.push("/announcements")} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Announcements
          </Button>
        </div>
      </PageLayout>
    );
  }

  const hasUsers = data.employee_ids && data.employee_ids.length > 0;
  const hasRoles = data.employee_role_ids && data.employee_role_ids.length > 0;

  return (
    <PageLayout>
      <PageHeader
        title={data.title}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/announcements")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => router.push(`/announcements/${id}/edit`)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            <span>Created: {format(new Date(data.created_at), "dd MMM yyyy")}</span>
          </div>
          {data.expiry_date && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              <span>Expires: {format(new Date(data.expiry_date), "dd MMM yyyy")}</span>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="mt-6 flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2">Content</h2>
            <div 
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.content }}
            />
          </div>
        </div>

        <div className="w-full lg:w-80 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="font-semibold border-b pb-2">Details</h3>
            
            {data.external_link && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">External Link</p>
                <a 
                  href={data.external_link} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline bg-primary/5 p-2 rounded-md break-all"
                >
                  <LinkIcon className="h-4 w-4 shrink-0" />
                  {data.external_link}
                </a>
              </div>
            )}

            {data.attachment_url && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Attachment</p>
                <a 
                  href={data.attachment_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline bg-primary/5 p-2 rounded-md break-all"
                >
                  <Paperclip className="h-4 w-4 shrink-0" />
                  {data.attachment_url.split('/').pop()}
                </a>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Target Audience</p>
              {!hasUsers && !hasRoles ? (
                <Badge variant="secondary">All Users</Badge>
              ) : (
                <div className="space-y-3">
                  {hasRoles && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Roles ({data.employee_role_ids.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.employee_role_ids.map((roleId: string) => (
                          <Badge key={roleId} variant="outline" className="text-xs">
                            {roles[roleId] || "Loading..."}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasUsers && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Specific Users ({data.employee_ids.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.employee_ids.map((empId: string) => (
                          <Badge key={empId} variant="outline" className="text-xs">
                            {employees[empId] || "Loading..."}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

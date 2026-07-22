"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Phone, Mail, Building2, MessageSquare, Pencil, UserCheck, MapPin, FileText, Loader2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { LeadForm } from "@/components/leads/lead-form";
import { Timeline } from "@/components/shared/timeline";
import { logModuleActivity } from "@/lib/activities";

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const supabase = createClient();
  const { account, user, canManageMembers } = useAuth();

  const [lead, setLead] = useState<any>(null);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  
  const [statuses, setStatuses] = useState<{name: string, color: string}[]>([]);
  
  // Ownership
  const [ownerName, setOwnerName] = useState<string>("Unknown");
  const [members, setMembers] = useState<{id: string, name: string}[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  // Customer hierarchy config, needed at conversion time.
  const [hierarchy, setHierarchy] = useState<{
    enabled: boolean;
    levels: { position: number; name: string }[];
  }>({ enabled: false, levels: [] });

  const fetchAllData = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    
    // 1. Fetch Lead
    const { data: leadData, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", resolvedParams.id)
      .eq("account_id", account.id)
      .maybeSingle();

    if (leadError || !leadData) {
      toast.error("Lead not found or you do not have permission to view it.");
      router.push("/leads");
      return;
    }
    setLead(leadData);

    // Fetch owner profile
    if (leadData.user_id) {
      const { data: ownerProfile } = await supabase.from('profiles').select('full_name, email').eq('user_id', leadData.user_id).single();
      if (ownerProfile) setOwnerName(ownerProfile.full_name || ownerProfile.email || "Unknown");
    }

    // Fetch members for collaborator dropdown
    if (canManageMembers) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').eq('account_id', account.id);
      if (profiles) {
        setMembers(profiles.map(p => ({ id: p.user_id, name: p.full_name || p.email })));
      }
    }

    // 2. Fetch everything else in parallel
    const [
      notesRes,
      fieldsRes,
      valuesRes,
      tasksRes,
      activitiesRes,
      statusRes
    ] = await Promise.all([
      supabase.from('lead_notes').select('*').eq('lead_id', resolvedParams.id).order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').or("module_name.eq.lead,module_name.is.null").order('field_name'),
      supabase.from('lead_custom_values').select('*').eq('lead_id', resolvedParams.id),
      supabase.from('tasks').select('*').eq('lead_id', resolvedParams.id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'lead').eq('record_id', resolvedParams.id).order('created_at', { ascending: false }),
      supabase.from('lead_statuses').select('name, color').eq('account_id', account.id).order('position')
    ]);

    if (notesRes.data) setNotes(notesRes.data);
    if (statusRes.data) setStatuses(statusRes.data);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    
    if (tasksRes.data) setTasks(tasksRes.data);

    const activitiesData = activitiesRes.data;
    if (activitiesData && activitiesData.length > 0) {
      const userIds = Array.from(new Set(activitiesData.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        
        const enrichedActivities = activitiesData.map((a: any) => ({
          ...a,
          user: profileMap[a.user_id] || null
        }));
        setActivities(enrichedActivities);
      } else {
        setActivities(activitiesData);
      }
    } else {
      setActivities([]);
    }

    setLoading(false);
  }, [resolvedParams.id, supabase, router, account, canManageMembers]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    if (!account?.id) return;
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("settings")
        .eq("id", account.id)
        .single();
      const os = data?.settings?.order_settings ?? {};
      setHierarchy({
        enabled: !!os.hierarchy_enabled,
        levels: Array.isArray(os.levels) ? os.levels : [],
      });
    })();
  }, [account?.id, supabase]);

  const handleConvert = async () => {
    if (!lead) return;

    // With hierarchy enabled the new customer needs a level, or the database
    // rejects the contact (migration 076) and the whole conversion rolls back.
    let level: number | null = null;
    if (hierarchy.enabled) {
      if (hierarchy.levels.length === 0) {
        toast.error("No customer levels are configured. Add them in Settings → Orders.");
        return;
      }
      const choice = window.prompt(
        `Customer Level is required.\n\n${hierarchy.levels
          .map((l) => `${l.position} = ${l.name}`)
          .join("\n")}\n\nEnter the level number:`,
        String(hierarchy.levels[0].position),
      );
      if (choice === null) return; // cancelled
      const parsed = Number(choice);
      if (!hierarchy.levels.some((l) => l.position === parsed)) {
        toast.error("That is not one of the configured levels.");
        return;
      }
      level = parsed;
    }

    setConverting(true);

    // Single atomic RPC (076_customer_level_enforcement.sql supersedes 067):
    // creates the customer, migrates custom values / notes / tasks /
    // activities, and flags the lead as converted (KEPT, not deleted) —
    // all-or-nothing.
    const { data: newContactId, error } = await supabase.rpc(
      "convert_lead_to_customer",
      { p_lead_id: lead.id, p_hierarchy_level: level }
    );

    if (error || !newContactId) {
      console.error("Conversion failed", error);
      toast.error(error?.message || "Failed to convert lead.");
      setConverting(false);
      return;
    }

    toast.success("Lead successfully converted to Customer!");
    router.push(`/contacts/${newContactId}`);
  };

  const handleCollaboratorChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const newCollabId = val === "none" ? null : val;
    setLead({ ...lead, collaborator_id: newCollabId });
    await supabase.from("leads").update({ collaborator_id: newCollabId }).eq("id", lead.id);
    toast.success("Collaborator updated.");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              {lead.name || "Unnamed Lead"}
              {statuses.length > 0 ? (
                <select
                  value={lead.status || "new"}
                  onChange={async (e) => {
                    const newStatus = e.target.value;
                    setLead({ ...lead, status: newStatus });
                    await supabase.from("leads").update({ status: newStatus }).eq("id", lead.id);
                    toast.success(`Status updated to ${newStatus}`);
                  }}
                  className="text-xs bg-muted border-none outline-none rounded-md px-2 py-1 cursor-pointer font-medium capitalize shadow-sm"
                >
                  <option value="">Select Status</option>
                  {statuses.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <Badge variant="secondary" className="capitalize text-xs bg-muted">
                  Status: {lead.status || "New"}
                </Badge>
              )}
              
              <Badge variant="outline" className="capitalize text-xs text-muted-foreground border-border bg-card">
                Source: {lead.source || "Unknown"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-4">
              {lead.whatsapp && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> <span className="font-medium text-foreground">WhatsApp:</span> {lead.whatsapp}</span>}
              {lead.email && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> <span className="font-medium text-foreground">Email:</span> {lead.email}</span>}
              {lead.industry && <span className="flex items-center gap-1.5"><Building2 className="size-3 text-primary/70" /> <span className="font-medium text-foreground">Industry:</span> {lead.industry}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.is_converted ? (
            <Button
              onClick={() => lead.converted_contact_id && router.push(`/contacts/${lead.converted_contact_id}`)}
              variant="outline"
              className="gap-2 border-green-500/30 text-green-600 shadow-sm"
            >
              <UserCheck className="size-4" />
              Converted — View Customer
            </Button>
          ) : (
            <Button onClick={handleConvert} disabled={converting} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm">
              {converting ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
              Convert to Customer
            </Button>
          )}
          {lead.whatsapp && (
            <Button onClick={() => router.push(`/inbox?phone=${lead.whatsapp}`)} variant="outline" className="gap-2 shadow-sm">
              <MessageSquare className="size-4" />
              Message
            </Button>
          )}
          <Button onClick={() => setEditOpen(true)} variant="secondary" className="gap-2 shadow-sm">
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
                Lead Details
              </h3>
              
              {/* Ownership Info */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md border border-border/50">
                <div className="flex items-center gap-1.5">
                  <UserIcon className="size-3.5" />
                  <span className="font-medium">Created By:</span>
                  <span className="text-foreground">{ownerName}</span>
                </div>
                
                <div className="w-px h-4 bg-border"></div>

                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Collaborator:</span>
                  {canManageMembers ? (
                    <select 
                      className="bg-transparent border-none outline-none text-foreground text-sm cursor-pointer py-0 px-1 font-medium"
                      value={lead.collaborator_id || "none"}
                      onChange={handleCollaboratorChange}
                    >
                      <option value="none">None</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-foreground">
                      {members.find(m => m.id === lead.collaborator_id)?.name || "None"}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Business Name</p>
                <p className="font-medium text-foreground">{lead.name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Contact Person</p>
                <p className="font-medium text-foreground">{lead.contact_person || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">WhatsApp / Phone</p>
                <p className="font-medium text-foreground">{lead.whatsapp || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Email</p>
                <p className="font-medium text-foreground">{lead.email || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Industry</p>
                <p className="font-medium text-foreground">{lead.industry || '-'}</p>
              </div>
            </div>

            {(lead.address || lead.city || lead.state || lead.country) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-5 flex items-center gap-2 text-foreground">
                  <MapPin className="size-5 text-muted-foreground" /> Location
                </h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {lead.address && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">Address</p>
                      <p className="font-medium text-foreground">{lead.address}</p>
                    </div>
                  )}
                  {lead.city && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">City</p>
                      <p className="font-medium text-foreground">{lead.city}</p>
                    </div>
                  )}
                  {lead.state && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">State/Region</p>
                      <p className="font-medium text-foreground">{lead.state}</p>
                    </div>
                  )}
                  {lead.country && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Country</p>
                      <p className="font-medium text-foreground">{lead.country}</p>
                    </div>
                  )}
                  {(lead.latitude || lead.longitude) && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">Coordinates</p>
                      <p className="font-medium text-xs font-mono text-muted-foreground bg-muted p-1.5 rounded inline-block">
                        {lead.latitude}, {lead.longitude}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {customFields.length > 0 && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-5 text-foreground">Other Details</h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {customFields.map((field) => {
                    const val = customValues[field.id];
                    return (
                      <div key={field.id}>
                        <p className="text-sm text-muted-foreground mb-1 capitalize">{field.field_name}</p>
                        {field.field_type === 'attachment' && val ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium flex items-center gap-1">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : (
                          <p className="font-medium text-foreground break-words">{val || '-'}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Timeline */}
        <div className="w-full">
          <Timeline 
            moduleName="lead" 
            recordId={lead.id} 
            tasks={tasks} 
            notes={notes}
            activities={activities} 
            onRefresh={fetchAllData} 
          />
        </div>
      </div>

      <LeadForm
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead}
        onSaved={fetchAllData}
      />
    </div>
  );
}

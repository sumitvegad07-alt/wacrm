"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Phone, Mail, Building2, MessageSquare, Pencil, UserCheck, MapPin, FileText, Loader2, User as UserIcon, Users, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { LeadForm } from "@/components/leads/lead-form";
import { Timeline } from "@/components/shared/timeline";
import { logModuleActivity } from "@/lib/activities";
import type { Profile } from "@/types";

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
  
  // Ownership & Collaboration
  const [ownerName, setOwnerName] = useState<string>("Unassigned");
  const [creatorName, setCreatorName] = useState<string>("Unknown");
  const [collaboratorProfiles, setCollaboratorProfiles] = useState<Profile[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [converting, setConverting] = useState(false);
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

    // Fetch all profiles for ownership/creator/collaborators mapping
    const { data: allProfilesData } = await supabase
      .from("profiles")
      .select("*")
      .eq("account_id", account.id);

    if (allProfilesData) {
      const allProfiles = allProfilesData as Profile[];

      // Creator
      const creator = allProfiles.find(p => p.id === leadData.user_id || p.user_id === leadData.user_id);
      setCreatorName(creator?.full_name || creator?.email || "User");

      // Owner
      const ownerId = leadData.owner_id || leadData.assigned_to;
      const owner = allProfiles.find(p => p.id === ownerId || p.user_id === ownerId);
      setOwnerName(owner?.full_name || owner?.email || "Unassigned");

      // Collaborators
      if (leadData.collaborator_ids && Array.isArray(leadData.collaborator_ids)) {
        const cProfs = allProfiles.filter(p =>
          leadData.collaborator_ids.includes(p.id) || leadData.collaborator_ids.includes(p.user_id)
        );
        setCollaboratorProfiles(cProfs);
      } else {
        setCollaboratorProfiles([]);
      }
    }

    // 2. Fetch dependencies in parallel
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
      valuesRes.data.forEach((v: any) => {
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
  }, [resolvedParams.id, supabase, router, account]);

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
      if (choice === null) return;
      const parsed = Number(choice);
      if (!hierarchy.levels.some((l) => l.position === parsed)) {
        toast.error("That is not one of the configured levels.");
        return;
      }
      level = parsed;
    }

    setConverting(true);
    try {
      const { data: newContactId, error } = await supabase.rpc(
        "convert_lead_to_customer",
        { p_lead_id: lead.id, p_hierarchy_level: level }
      );

      if (error || !newContactId) {
        console.error("Conversion failed", error);
        toast.error(error?.message || "Failed to convert lead.");
        return;
      }

      toast.success("Lead successfully converted to Customer!");
      router.push(`/contacts/${newContactId}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to convert lead.");
    } finally {
      setConverting(false);
    }
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
    <div className="space-y-6 w-full max-w-none flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg shadow-sm">
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
              {lead.name}
              {lead.is_converted && (
                <Badge className="bg-emerald-600 text-white border-transparent shadow-sm gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Converted to Customer
                </Badge>
              )}
              {!lead.is_converted && (
                <Badge 
                  className="capitalize font-semibold text-white shadow-sm border-transparent"
                  style={{
                    backgroundColor: statuses.find(s => s.name.toLowerCase() === lead.status?.toLowerCase())?.color || '#6366f1',
                  }}
                >
                  {lead.status || 'New'}
                </Badge>
              )}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-4">
              {lead.company && <span className="flex items-center gap-1"><Building2 className="size-3.5" /> {lead.company}</span>}
              {lead.phone && <span className="flex items-center gap-1"><Phone className="size-3.5" /> {lead.phone}</span>}
              {lead.email && <span className="flex items-center gap-1"><Mail className="size-3.5" /> {lead.email}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lead.is_converted && lead.converted_contact_id ? (
            <Link href={`/contacts/${lead.converted_contact_id}`}>
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                <ExternalLink className="size-4" />
                View Customer
              </Button>
            </Link>
          ) : (
            <Button 
              onClick={handleConvert} 
              disabled={converting}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
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
          <Button onClick={() => router.push(`/leads/${lead.id}/edit`)} variant="secondary" className="gap-2 shadow-sm">
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Ownership */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5 shadow-sm space-y-6">
            <h3 className="text-lg font-semibold border-b border-border pb-3 text-foreground">
              Lead Details & Ownership
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 gap-x-4">
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
              <div>
                <p className="text-sm text-muted-foreground mb-1">Source</p>
                <p className="font-medium text-foreground">{lead.source || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {lead.status || 'new'}
                  </Badge>
                  {lead.is_converted && (
                    <Badge className="bg-emerald-600 text-white">Won (Converted)</Badge>
                  )}
                  {!lead.is_active && !lead.is_converted && (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Collaborators List */}
            <div className="pt-2">
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Collaborators ({collaboratorProfiles.length})
              </p>
              {collaboratorProfiles.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No collaborators assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {collaboratorProfiles.map((prof) => (
                    <Badge key={prof.id} variant="secondary" className="px-2.5 py-1 text-xs font-normal">
                      {prof.full_name || prof.email}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {lead.notes && (
              <div className="pt-4 border-t border-border/50">
                <p className="text-sm text-muted-foreground mb-2">Lead Notes</p>
                <p className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded-md border border-border/50">{lead.notes}</p>
              </div>
            )}

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

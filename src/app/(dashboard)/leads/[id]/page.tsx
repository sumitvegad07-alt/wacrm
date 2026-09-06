"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";
import { ChevronLeft, MessageSquare, Pencil, UserCheck, MapPin, FileText, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { LeadForm } from "@/components/leads/lead-form";
import { Timeline } from "@/components/shared/timeline";
import { logModuleActivity } from "@/lib/activities";
import type { Profile } from "@/types";

interface DealRow {
  id: string;
  created_at: string;
  status: string | null;
  assigned_to: string | null;
  user_id: string | null;
  pipeline?: { name?: string | null } | null;
  stage?: { name?: string | null } | null;
}

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
  const [deals, setDeals] = useState<DealRow[]>([]);

  const [statuses, setStatuses] = useState<{ name: string; color: string }[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);

  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [hierarchy, setHierarchy] = useState<{
    enabled: boolean;
    levels: { position: number; name: string }[];
  }>({ enabled: false, levels: [] });

  // Who may reassign / restatus this lead.
  const canEdit = !!(canManageMembers || (lead && (lead.owner_id === user?.id || lead.user_id === user?.id)));

  const fetchAllData = useCallback(async () => {
    if (!account) return;
    setLoading(true);

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

    const [
      profilesRes,
      notesRes,
      fieldsRes,
      valuesRes,
      tasksRes,
      activitiesRes,
      statusRes,
      dealsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("account_id", account.id),
      supabase.from("lead_notes").select("*").eq("lead_id", resolvedParams.id).order("created_at", { ascending: false }),
      supabase.from("custom_fields").select("*").or("module_name.eq.lead,module_name.is.null").order("field_name"),
      supabase.from("lead_custom_values").select("*").eq("lead_id", resolvedParams.id),
      supabase.from("tasks").select("*").eq("lead_id", resolvedParams.id).order("created_at", { ascending: false }),
      supabase.from("module_activities").select("*").eq("module_name", "lead").eq("record_id", resolvedParams.id).order("created_at", { ascending: false }),
      supabase.from("lead_statuses").select("name, color").eq("account_id", account.id).order("position"),
      supabase
        .from("deals")
        .select("id, created_at, status, assigned_to, user_id, pipeline:pipelines(name), stage:pipeline_stages(name)")
        .eq("lead_id", resolvedParams.id)
        .order("created_at", { ascending: false }),
    ]);

    if (profilesRes.data) setAllProfiles(profilesRes.data as Profile[]);
    if (notesRes.data) setNotes(notesRes.data);
    if (statusRes.data) setStatuses(statusRes.data);
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (dealsRes.data) setDeals(dealsRes.data as unknown as DealRow[]);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v: any) => {
        map[v.custom_field_id] = v.value ?? "";
      });
      setCustomValues(map);
    }
    if (tasksRes.data) setTasks(tasksRes.data);

    const activitiesData = activitiesRes.data;
    if (activitiesData && activitiesData.length > 0) {
      const userIds = Array.from(new Set(activitiesData.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        setActivities(activitiesData.map((a: any) => ({ ...a, user: profileMap[a.user_id] || null })));
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
      const { data } = await supabase.from("accounts").select("settings").eq("id", account.id).single();
      const os = data?.settings?.order_settings ?? {};
      setHierarchy({ enabled: !!os.hierarchy_enabled, levels: Array.isArray(os.levels) ? os.levels : [] });
    })();
  }, [account?.id, supabase]);

  // Names for the deal table + owner display.
  const nameForUser = (id: string | null | undefined) => {
    if (!id) return "—";
    const p = allProfiles.find((x) => x.user_id === id || x.id === id);
    return p?.full_name || p?.email || "—";
  };

  // Auto-save a single change to the lead and refresh.
  async function persistLead(patch: Record<string, unknown>, activityMessage?: string) {
    if (!canEdit) return;
    const { error } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (error) {
      toast.error(`Could not update: ${error.message}`);
      return;
    }
    if (activityMessage) {
      await logModuleActivity(supabase, { moduleName: "lead", recordId: lead.id, action: "updated", message: activityMessage });
    }
    toast.success("Updated");
    fetchAllData();
  }

  async function createStatusInline(name: string): Promise<{ value: string; label: string } | null> {
    if (!account) return null;
    const { data, error } = await supabase
      .from("lead_statuses")
      .insert({ account_id: account.id, name })
      .select("name, color")
      .single();
    if (error || !data) {
      toast.error(error?.message || "Could not create status");
      return null;
    }
    setStatuses((prev) => [...prev, data]);
    return { value: data.name, label: data.name };
  }

  const handleConvert = async () => {
    if (!lead) return;
    let level: number | null = null;
    if (hierarchy.enabled) {
      if (hierarchy.levels.length === 0) {
        toast.error("No customer levels are configured. Add them in Settings → Orders.");
        return;
      }
      const choice = window.prompt(
        `Customer Level is required.\n\n${hierarchy.levels.map((l) => `${l.position} = ${l.name}`).join("\n")}\n\nEnter the level number:`,
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
      const { data: newContactId, error } = await supabase.rpc("convert_lead_to_customer", { p_lead_id: lead.id, p_hierarchy_level: level });
      if (error || !newContactId) {
        toast.error(error?.message || "Failed to convert lead.");
        return;
      }
      toast.success("Lead successfully converted to Customer!");
      router.push(`/contacts/${newContactId}`);
    } catch (err: any) {
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

  const locationParts = [lead.city, lead.state, lead.country].filter(Boolean);
  const ownerOptions = allProfiles.map((p) => ({ value: p.user_id, label: p.full_name || p.email || "User" }));
  const collaboratorIds: string[] = Array.isArray(lead.collaborator_ids) ? lead.collaborator_ids : [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/leads")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-5" />
          </Button>
          <Link href="/leads" className="text-muted-foreground hover:text-foreground">Lead</Link>
          <span className="text-muted-foreground">›</span>
          <span className="font-medium text-foreground">{lead.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lead.is_converted && lead.converted_contact_id ? (
            <Link href={`/contacts/${lead.converted_contact_id}`}>
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><ExternalLink className="size-4" /> View Customer</Button>
            </Link>
          ) : (
            <Button onClick={handleConvert} disabled={converting} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              {converting ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />} Convert to Customer
            </Button>
          )}
          {lead.whatsapp && (
            <Button onClick={() => router.push(`/inbox?phone=${lead.whatsapp}`)} variant="outline" className="gap-2"><MessageSquare className="size-4" /> Message</Button>
          )}
          <Button onClick={() => router.push(`/leads/${lead.id}/edit`)} variant="secondary" className="gap-2"><Pencil className="size-4" /> Edit</Button>
        </div>
      </div>

      {/* Owner / Collaborators band */}
      <div className="flex flex-col gap-4 border-y border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-start sm:gap-10">
        <div className="min-w-[200px]">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Lead Owner</p>
          <SearchableSelect
            value={lead.owner_id || ""}
            onChange={(val) => persistLead({ owner_id: val || null }, `Owner changed to ${nameForUser(val)}.`)}
            options={ownerOptions}
            placeholder="Unassigned"
            disabled={!canEdit}
            className="bg-background"
          />
        </div>
        <div className="flex-1">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Collaborators</p>
          <CollaboratorsSelect
            profiles={allProfiles}
            selectedIds={collaboratorIds}
            disabled={!canEdit}
            onChange={(ids) => persistLead({ collaborator_ids: ids })}
          />
        </div>
      </div>

      {/* Name + status */}
      <div className="flex flex-col gap-4 px-4 py-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground">
            {lead.name}
            {lead.is_converted && (
              <Badge className="gap-1 border-transparent bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3" /> Converted</Badge>
            )}
          </h1>
          {locationParts.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4" /> {locationParts.join(", ")}.
            </p>
          )}
        </div>
        <div className="w-full sm:w-56">
          <SearchableSelect
            value={lead.status || ""}
            onChange={(val) => persistLead({ status: val || null }, `Status changed to ${val}.`)}
            options={statuses.map((s) => ({ value: s.name, label: s.name }))}
            placeholder="Set status..."
            disabled={!canEdit}
            onCreateOption={createStatusInline}
          />
        </div>
      </div>

      {/* Source / Industry / Price Group */}
      <div className="grid grid-cols-1 gap-6 border-t border-border px-4 py-6 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Source</p>
          <p className="mt-1 font-medium text-foreground">{lead.source || "-"}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Industry</p>
          <p className="mt-1 font-medium text-foreground">{lead.industry || "-"}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Price Group</p>
          <p className="mt-1 font-medium text-foreground">-</p>
        </div>
      </div>

      {/* Contact + location details */}
      {(lead.contact_person || lead.whatsapp || lead.email || lead.address) && (
        <div className="grid grid-cols-1 gap-6 border-t border-border px-4 py-6 sm:grid-cols-3">
          {lead.contact_person && (
            <div><p className="text-sm text-muted-foreground">Contact Person</p><p className="mt-1 font-medium text-foreground">{lead.contact_person}</p></div>
          )}
          {lead.whatsapp && (
            <div><p className="text-sm text-muted-foreground">WhatsApp / Phone</p><p className="mt-1 font-medium text-foreground">{lead.whatsapp}</p></div>
          )}
          {lead.email && (
            <div><p className="text-sm text-muted-foreground">Email</p><p className="mt-1 font-medium text-foreground">{lead.email}</p></div>
          )}
          {lead.address && (
            <div className="sm:col-span-3"><p className="text-sm text-muted-foreground">Address</p><p className="mt-1 font-medium text-foreground">{lead.address}</p></div>
          )}
        </div>
      )}

      {/* Other Details (custom fields) */}
      <div className="border-t border-border px-4 py-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Other Details</h2>
        {customFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No additional details.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {customFields.map((field) => {
              const val = customValues[field.id];
              return (
                <div key={field.id}>
                  <p className="text-sm capitalize text-muted-foreground">{field.field_name}</p>
                  {field.field_type === "attachment" && val ? (
                    <a href={val} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 font-medium text-primary hover:underline">
                      <FileText className="size-4" /> View Attachment
                    </a>
                  ) : (
                    <p className="mt-1 font-medium text-foreground break-words">{val || "-"}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deal Details */}
      <div className="border-t border-border px-4 py-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Deal Details</h2>
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals linked to this lead.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Deal #</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Pipeline Name</th>
                  <th className="px-4 py-3 font-medium">Pipeline Status</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Created By</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/deals/${d.id}`)}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-primary">#{d.id.slice(0, 6)}</td>
                    <td className="px-4 py-3 text-foreground">{new Date(d.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-foreground">{d.pipeline?.name || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{d.stage?.name || "-"}</td>
                    <td className="px-4 py-3 text-foreground">{nameForUser(d.assigned_to)}</td>
                    <td className="px-4 py-3 text-foreground">{nameForUser(d.user_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="border-t border-border px-4 py-6">
        <Timeline moduleName="lead" recordId={lead.id} tasks={tasks} notes={notes} activities={activities} onRefresh={fetchAllData} />
      </div>

      <LeadForm open={editOpen} onOpenChange={setEditOpen} lead={lead} onSaved={fetchAllData} />
    </div>
  );
}

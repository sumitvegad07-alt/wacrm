"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useMarkRecordSeen } from "@/hooks/use-record-views";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";
import { MessageSquare, Pencil, UserCheck, MapPin, FileText, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { LeadForm } from "@/components/leads/lead-form";
import { Timeline } from "@/components/shared/timeline";
import {
  DetailPageLayout,
  DetailSection,
  DetailGrid,
  DetailItem,
  FormGrid,
  FormField,
  LineItemsTable,
  LineItemsHead,
  LineItemsRow,
  LineItemsCell,
} from "@/components/shared";
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

  // Opening the record is what clears its highlight on the list.
  useMarkRecordSeen("lead", resolvedParams.id);
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
      supabase
        .from("custom_fields")
        .select("*")
        .eq("account_id", account.id)
        .eq("module_name", "lead")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
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

  // The lead's field setup drives this page exactly like it drives the form:
  // a deactivated field disappears, a renamed field re-labels, and a predefined
  // (system_key) field reads its value from the lead row — never from
  // lead_custom_values, which only ever holds true custom fields.
  const activeFields = customFields.filter((f) => f.is_active !== false);
  const systemField = (key: string) => activeFields.find((f) => f.system_key === key);
  const hasSystem = (key: string) => !!systemField(key);
  const labelFor = (key: string, fallback: string) => systemField(key)?.field_name || fallback;
  const extraFields = activeFields.filter((f) => !f.system_key);

  // Predefined contact rows: shown only when the field is active and the lead
  // actually carries a value. `phone` was missing here, so Lead Discovery leads
  // (which fill phone, not whatsapp) showed no contact number at all.
  const contactRows = ([
    ["contact_person", "Contact Person", lead.contact_person],
    ["phone", "Phone Number", lead.phone],
    ["whatsapp", "WhatsApp Number", lead.whatsapp],
    ["email", "Email", lead.email],
    ["area", "Area / Locality", lead.area],
    ["pincode", "Pincode / ZIP", lead.pincode],
  ] as [string, string, string | null][]).filter(([key, , value]) => hasSystem(key) && !!value);
  const showAddress = hasSystem("address") && !!lead.address;
  const showCoords = lead.latitude != null && lead.longitude != null;

  return (
    // Was `mx-auto w-full max-w-7xl` — the only centred, width-capped page in
    // the app, so a lead record was narrower than every other detail screen on
    // a wide monitor. DetailPageLayout is full width like the rest.
    <DetailPageLayout
      title={lead.name}
      onBack={() => router.push("/leads")}
      badges={
        lead.is_converted ? (
          <Badge className="gap-1 border-transparent bg-emerald-600 text-white">
            <CheckCircle2 className="h-3 w-3" /> Converted
          </Badge>
        ) : undefined
      }
      meta={
        locationParts.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4" /> {locationParts.join(", ")}
          </span>
        ) : undefined
      }
      actions={
        <>
          {lead.is_converted && lead.converted_contact_id ? (
            <Link href={`/contacts/${lead.converted_contact_id}`}>
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><ExternalLink className="size-4" /> View Customer</Button>
            </Link>
          ) : (
            <Button onClick={handleConvert} disabled={converting} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              {converting ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />} Convert to Customer
            </Button>
          )}
          {(lead.whatsapp || lead.phone) && (
            <Button onClick={() => router.push(`/inbox?phone=${lead.whatsapp || lead.phone}`)} variant="outline" className="gap-2"><MessageSquare className="size-4" /> Message</Button>
          )}
          <Button onClick={() => router.push(`/leads/${lead.id}/edit`)} variant="secondary" className="gap-2"><Pencil className="size-4" /> Edit</Button>
        </>
      }
    >

      {/* The inline-editable band: everything on this record that is changed
          without opening the edit form. Status joined Owner and Collaborators
          here — it used to float beside the h1, which is the one place on a
          detail page that is otherwise read-only. */}
      <DetailSection bare className="rounded-lg border border-border bg-muted/30 p-4">
        <FormGrid variant="dialog" className="md:grid-cols-3">
          <FormField label="Lead Owner">
            <SearchableSelect
              value={lead.owner_id || ""}
              onChange={(val) => persistLead({ owner_id: val || null }, `Owner changed to ${nameForUser(val)}.`)}
              options={ownerOptions}
              placeholder="Unassigned"
              disabled={!canEdit}
            />
          </FormField>
          <FormField label="Status">
            <SearchableSelect
              value={lead.status || ""}
              onChange={(val) => persistLead({ status: val || null }, `Status changed to ${val}.`)}
              options={statuses.map((st) => ({ value: st.name, label: st.name }))}
              placeholder="Set status..."
              disabled={!canEdit}
              onCreateOption={createStatusInline}
              createLabel="status"
            />
          </FormField>
          <FormField label="Collaborators">
            <CollaboratorsSelect
              profiles={allProfiles}
              selectedIds={collaboratorIds}
              disabled={!canEdit}
              onChange={(ids) => persistLead({ collaborator_ids: ids })}
            />
          </FormField>
        </FormGrid>
      </DetailSection>

      {/* Two columns: details on the left, activity timeline on the right. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">

      {/* Source / Industry. "Price Group" used to sit here showing a permanent "-";
          leads have no price group, so the tile is gone. */}
      {(hasSystem("source") || hasSystem("industry")) && (
        <DetailSection>
          <DetailGrid cols={3}>
            {hasSystem("source") && (
              <DetailItem label={labelFor("source", "Source")} value={lead.source} />
            )}
            {hasSystem("industry") && (
              <DetailItem label={labelFor("industry", "Industry")} value={lead.industry} />
            )}
          </DetailGrid>
        </DetailSection>
      )}

      {/* Contact + location details */}
      {(contactRows.length > 0 || showAddress || showCoords) && (
        <DetailSection title="Contact &amp; Location">
          <DetailGrid cols={3}>
            {contactRows.map(([key, fallback, value]) => (
              <DetailItem key={key} label={labelFor(key, fallback)} value={value} />
            ))}
            {showAddress && (
              <DetailItem span="full" label={labelFor("address", "Address")} value={lead.address} />
            )}
            {showCoords && (
              <DetailItem label="Coordinates (geo-tagged)">
                <span className="font-mono">{lead.latitude}, {lead.longitude}</span>
              </DetailItem>
            )}
          </DetailGrid>
        </DetailSection>
      )}

      {/* Other Details (custom fields) */}
      <DetailSection title="Other Details">
        {extraFields.length === 0 ? (
          <p className="text-body text-muted-foreground">No additional details.</p>
        ) : (
          <DetailGrid cols={3}>
            {extraFields.map((field) => {
              const val = customValues[field.id];
              return (
                <DetailItem
                  key={field.id}
                  label={field.field_name}
                  className="[&>p:first-child]:capitalize"
                  value={field.field_type === "attachment" ? undefined : val}
                >
                  {field.field_type === "attachment" && val ? (
                    <a href={val} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-primary hover:underline">
                      <FileText className="size-4" /> View Attachment
                    </a>
                  ) : undefined}
                </DetailItem>
              );
            })}
          </DetailGrid>
        )}
      </DetailSection>

      {/* Deal Details */}
      <DetailSection title="Deal Details">
        {deals.length === 0 ? (
          <p className="text-body text-muted-foreground">No deals linked to this lead.</p>
        ) : (
          <LineItemsTable
            minWidth="45rem"
            head={
              <tr>
                <LineItemsHead>Deal #</LineItemsHead>
                <LineItemsHead>Date</LineItemsHead>
                <LineItemsHead>Pipeline Name</LineItemsHead>
                <LineItemsHead>Pipeline Status</LineItemsHead>
                <LineItemsHead>Owner</LineItemsHead>
                <LineItemsHead>Created By</LineItemsHead>
              </tr>
            }
          >
            {deals.map((d) => (
              <LineItemsRow key={d.id} onClick={() => router.push(`/deals/${d.id}`)}>
                <LineItemsCell className="font-mono text-caption text-primary">#{d.id.slice(0, 6)}</LineItemsCell>
                <LineItemsCell>{new Date(d.created_at).toLocaleString()}</LineItemsCell>
                <LineItemsCell>{d.pipeline?.name || "—"}</LineItemsCell>
                <LineItemsCell>{d.stage?.name || "—"}</LineItemsCell>
                <LineItemsCell>{nameForUser(d.assigned_to)}</LineItemsCell>
                <LineItemsCell>{nameForUser(d.user_id)}</LineItemsCell>
              </LineItemsRow>
            ))}
          </LineItemsTable>
        )}
      </DetailSection>

        </div>

        {/* Right column: activity timeline (kept on the right, as before). */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border border-border bg-card p-4 lg:sticky lg:top-4">
            <Timeline moduleName="lead" recordId={lead.id} tasks={tasks} notes={notes} activities={activities} onRefresh={fetchAllData} />
          </div>
        </div>
      </div>

      <LeadForm open={editOpen} onOpenChange={setEditOpen} lead={lead} onSaved={fetchAllData} />
    </DetailPageLayout>
  );
}

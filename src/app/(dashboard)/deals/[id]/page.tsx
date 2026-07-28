"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Deal, CustomField, Task, Contact, Conversation, PipelineStage, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Calendar, CheckSquare, MessageSquare, Briefcase, FileText, Loader2, Pencil, Check, X, Users, ShoppingBag, ArrowRight, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { DealForm } from "@/components/pipelines/deal-form";
import { Timeline } from "@/components/shared/timeline";

export default function DealDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { profile: currentUser } = useAuth();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [dealItems, setDealItems] = useState<any[]>([]);
  const [creatorProfile, setCreatorProfile] = useState<Profile | null>(null);
  const [collaboratorProfiles, setCollaboratorProfiles] = useState<Profile[]>([]);
  const [lead, setLead] = useState<any | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    
    // 1. Fetch Deal
    const { data: dealData, error: dealError } = await supabase
      .from("deals")
      .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*), stage:pipeline_stages(*)")
      .eq("id", id)
      .maybeSingle();

    if (dealError || !dealData) {
      toast.error("Deal not found");
      router.push("/pipelines");
      return;
    }
    setDeal(dealData as Deal);

    // 2. Fetch dependencies & items in parallel
    const [
      stagesRes,
      fieldsRes,
      valuesRes,
      tasksRes,
      activitiesRes,
      convRes,
      itemsRes,
      profilesRes,
      leadRes
    ] = await Promise.all([
      supabase.from('pipeline_stages').select('*').eq('pipeline_id', dealData.pipeline_id).order('position'),
      supabase.from('custom_fields').select('*').eq('module_name', 'deal').order('field_name'),
      supabase.from('deal_custom_values').select('*').eq('deal_id', id),
      supabase.from('tasks').select('*').eq('deal_id', id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'deal').eq('record_id', id).order('created_at', { ascending: false }),
      dealData.contact_id 
        ? supabase.from('conversations').select('*, contact:contacts(name, phone)').eq('contact_id', dealData.contact_id).order('last_message_at', { ascending: false }).limit(5)
        : Promise.resolve({ data: [] }),
      supabase.from('deal_items').select('*').eq('deal_id', id).order('position', { ascending: true }),
      supabase.from('profiles').select('*'),
      dealData.lead_id 
        ? supabase.from('leads').select('*').eq('id', dealData.lead_id).maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    if (stagesRes.data) setStages(stagesRes.data);
    if (itemsRes.data) setDealItems(itemsRes.data);
    if (leadRes.data) setLead(leadRes.data);

    if (profilesRes.data) {
      const allProfiles = profilesRes.data as Profile[];
      const creator = allProfiles.find(p => p.id === dealData.creator_id || p.user_id === dealData.creator_id);
      setCreatorProfile(creator || null);

      if (dealData.collaborator_ids && Array.isArray(dealData.collaborator_ids)) {
        const collabProfs = allProfiles.filter(p => 
          dealData.collaborator_ids.includes(p.id) || dealData.collaborator_ids.includes(p.user_id)
        );
        setCollaboratorProfiles(collabProfs);
      } else {
        setCollaboratorProfiles([]);
      }
    }

    // Custom Fields
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v: any) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    
    // Tasks
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);
    
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

    // Conversations
    if (convRes.data) setConversations(convRes.data as Conversation[]);

    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleStageChange = async (newStageId: string) => {
    if (!deal || deal.stage_id === newStageId) return;

    const { error } = await supabase
      .from("deals")
      .update({ stage_id: newStageId })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update deal stage");
      return;
    }

    toast.success("Stage updated");
    fetchAllData();
  };

  const handleConvertToQuotation = async () => {
    if (!deal) return;
    if (!confirm("Are you sure you want to convert this deal into a quotation? All items and logs will be copied and the deal will be moved to inactive.")) {
      return;
    }

    setConverting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not authenticated");

      const { data: accountData } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', userData.user.id)
        .single();
      if (!accountData) throw new Error("No account found");

      // Compute totals from dealItems or deal value
      const subTotal = dealItems.length > 0 
        ? dealItems.reduce((sum, item) => sum + (Number(item.sub_total) || 0), 0)
        : Number(deal.value) || 0;
      const taxTotal = dealItems.length > 0 
        ? dealItems.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0)
        : 0;
      const totalAmount = dealItems.length > 0 
        ? dealItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0)
        : Number(deal.value) || 0;

      const quotationPayload = {
        account_id: accountData.account_id,
        user_id: userData.user.id,
        contact_id: deal.contact_id || null,
        lead_id: deal.lead_id || null,
        date: new Date().toISOString().split('T')[0],
        valid_until: null,
        status: 'Draft',
        terms_conditions: deal.notes || '',
        sub_total: subTotal,
        tax_total: taxTotal,
        total_amount: totalAmount,
      };

      const { data: newQuotation, error: qErr } = await supabase
        .from("quotations")
        .insert(quotationPayload)
        .select()
        .single();

      if (qErr || !newQuotation) throw qErr || new Error("Failed to create quotation");

      // Insert quotation items
      if (dealItems.length > 0) {
        const qItems = dealItems.map((item, idx) => ({
          quotation_id: newQuotation.id,
          product_id: item.product_id || null,
          product_name: item.product_name,
          unit: item.unit || "Nos",
          quantity: item.quantity,
          price: item.price,
          tax_rate: item.tax_rate,
          tax_amount: item.tax_amount,
          sub_total: item.sub_total,
          total: item.total,
          position: idx
        }));
        await supabase.from("quotation_items").insert(qItems);
      } else {
        // Fallback item if no line items were created
        await supabase.from("quotation_items").insert([{
          quotation_id: newQuotation.id,
          product_name: deal.title,
          unit: "Nos",
          quantity: 1,
          price: Number(deal.value) || 0,
          tax_rate: 0,
          tax_amount: 0,
          sub_total: Number(deal.value) || 0,
          total: Number(deal.value) || 0,
          position: 0
        }]);
      }

      // Copy timeline logs from module_activities
      if (activities && activities.length > 0) {
        const copiedLogs = activities.map((act) => ({
          account_id: accountData.account_id,
          module_name: "quotation",
          record_id: newQuotation.id,
          user_id: act.user_id || userData.user.id,
          action: act.action || "copied_from_deal",
          description: `[From Deal] ${act.description || ""}`
        }));
        await supabase.from("module_activities").insert(copiedLogs);
      }

      // Log conversion activity on Deal
      await supabase.from("module_activities").insert({
        account_id: accountData.account_id,
        module_name: "deal",
        record_id: deal.id,
        user_id: userData.user.id,
        action: "converted_to_quotation",
        description: `Converted deal to Quotation #${newQuotation.quotation_number || newQuotation.id.slice(0, 8)}`
      });

      // Update deal: mark converted & inactive
      await supabase
        .from("deals")
        .update({
          is_converted: true,
          is_active: false,
          converted_quotation_id: newQuotation.id,
          status: "won"
        })
        .eq("id", deal.id);

      toast.success("Deal converted to Quotation!");
      router.push(`/quotations/${newQuotation.id}/edit`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to convert deal to quotation");
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

  if (!deal) return null;

  const currentStageIndex = stages.findIndex(s => s.id === deal.stage_id);

  return (
    <div className="space-y-6 w-full max-w-none flex flex-col h-full">
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
              {deal.deal_number && <span className="text-muted-foreground font-mono text-lg">{deal.deal_number}</span>}
              {deal.title}
              {deal.is_converted && (
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Converted to Quotation
                </Badge>
              )}
              {!deal.is_converted && deal.status === "won" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                  <Check className="h-3 w-3" />
                  Won
                </span>
              )}
              {!deal.is_converted && deal.status === "lost" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-400 border border-red-500/20">
                  <X className="h-3 w-3" />
                  Lost
                </span>
              )}
              {!deal.is_converted && deal.status === "open" && deal.stage && (
                <Badge style={{ backgroundColor: deal.stage.color + '20', color: deal.stage.color, borderColor: deal.stage.color + '40' }} variant="outline">
                  {deal.stage.name}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-4">
              <span className="font-semibold text-primary">{formatCurrency(deal.value, deal.currency)}</span>
              {deal.expected_close_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" /> Close: {new Date(deal.expected_close_date).toLocaleDateString()}
                </span>
              )}
              {deal.contact && (
                <Link href={`/contacts/${deal.contact_id}`} className="flex items-center gap-1 hover:underline text-foreground">
                  <Briefcase className="size-3.5" /> {deal.contact.name || deal.contact.phone}
                </Link>
              )}
              {lead && (
                <Link href={`/leads`} className="flex items-center gap-1 hover:underline text-foreground">
                  <Briefcase className="size-3.5" /> Lead: {lead.name}
                </Link>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {deal.is_converted && deal.converted_quotation_id ? (
            <Link href={`/quotations/${deal.converted_quotation_id}/edit`}>
              <Button variant="outline" className="gap-2 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10">
                <ExternalLink className="size-4" />
                View Quotation
              </Button>
            </Link>
          ) : (
            <Button
              onClick={handleConvertToQuotation}
              disabled={converting}
              variant="default"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {converting ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Convert to Quotation
            </Button>
          )}

          {deal.contact && (
            <Button onClick={() => router.push(`/inbox?phone=${deal.contact?.phone}`)} variant="outline" className="gap-2">
              <MessageSquare className="size-4" />
              Message Customer
            </Button>
          )}
          <Button onClick={() => router.push(`/deals/${deal.id}/edit`)} variant="outline" className="gap-2">
            <Pencil className="size-4" />
            Edit Deal
          </Button>
        </div>
      </div>

      {/* Visual Pipeline Stage Stepper Bar */}
      {stages.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between overflow-x-auto gap-2 py-1">
            {stages.map((stage, idx) => {
              const isActive = stage.id === deal.stage_id;
              const isPast = idx < currentStageIndex;

              return (
                <div key={stage.id} className="flex items-center flex-1 min-w-[140px]">
                  <button
                    type="button"
                    onClick={() => handleStageChange(stage.id)}
                    disabled={isActive}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md w-full transition-all text-left ${
                      isActive
                        ? "bg-primary text-primary-foreground font-medium shadow-sm"
                        : isPast
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? "bg-primary-foreground text-primary"
                          : isPast
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isPast ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                    </span>
                    <span className="truncate text-xs sm:text-sm">{stage.name}</span>
                  </button>
                  {idx < stages.length - 1 && (
                    <ArrowRight className="h-4 w-4 mx-1.5 text-muted-foreground/50 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details, Line Items, & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5 shadow-sm space-y-6">
            <h3 className="text-lg font-semibold border-b border-border pb-3">Deal Details & Collaboration</h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Title</p>
                <p className="font-medium">{deal.title}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Deal For</p>
                {deal.deal_for === "lead" ? (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    Lead: {lead?.name || "Selected Lead"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                    Customer: {deal.contact?.name || deal.contact?.phone || "Customer"}
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Value</p>
                <p className="font-medium text-primary">{formatCurrency(deal.value, deal.currency)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Assigned Sales Owner</p>
                <p className="font-medium">{deal.assignee?.full_name || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Creator</p>
                <p className="font-medium text-foreground">
                  {creatorProfile?.full_name || creatorProfile?.email || "User"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <p className="font-medium capitalize">{deal.status}</p>
              </div>
            </div>

            {/* Collaborators List */}
            <div className="pt-2">
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Collaborators ({collaboratorProfiles.length})
              </p>
              {collaboratorProfiles.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No additional collaborators added.</p>
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

            {deal.notes && (
              <div className="pt-4 border-t border-border/50">
                <p className="text-sm text-muted-foreground mb-2">Deal Notes</p>
                <p className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded-md border border-border/50">{deal.notes}</p>
              </div>
            )}
          </div>

          {/* Product Line Items Read-only Card */}
          <div className="bg-card border border-border rounded-lg p-5 shadow-sm space-y-4">
            <h3 className="text-lg font-semibold border-b border-border pb-3 flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Product Line Items ({dealItems.length})
            </h3>
            
            {dealItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No products added to this deal yet.</p>
            ) : (
              <div className="space-y-4">
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2.5 px-4 text-left font-medium">Product / Description</th>
                        <th className="py-2.5 px-4 text-left font-medium">Unit</th>
                        <th className="py-2.5 px-4 text-right font-medium">Qty</th>
                        <th className="py-2.5 px-4 text-right font-medium">Rate (₹)</th>
                        <th className="py-2.5 px-4 text-right font-medium">Tax %</th>
                        <th className="py-2.5 px-4 text-right font-medium">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dealItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="py-2.5 px-4 font-medium">{item.product_name}</td>
                          <td className="py-2.5 px-4 text-muted-foreground">{item.unit || "Nos"}</td>
                          <td className="py-2.5 px-4 text-right">{item.quantity}</td>
                          <td className="py-2.5 px-4 text-right">
                            ₹{Number(item.price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-4 text-right">{item.tax_rate}%</td>
                          <td className="py-2.5 px-4 text-right font-semibold">
                            ₹{Number(item.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="text-right space-y-1 text-sm bg-muted/50 p-4 rounded-lg border border-border min-w-[240px]">
                    <div className="flex justify-between font-semibold text-foreground">
                      <span>Total Value:</span>
                      <span className="text-primary">
                        ₹{dealItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {customFields.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-5 shadow-sm space-y-4">
              <h3 className="text-lg font-semibold border-b border-border pb-3">Custom Fields</h3>
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
                        <p className="font-medium break-words">{val || '-'}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Timeline */}
        <div className="w-full">
          <Timeline 
            moduleName="deal" 
            recordId={id} 
            tasks={tasks} 
            activities={activities} 
            onRefresh={fetchAllData} 
          />
        </div>
      </div>

      <DealForm
        open={editOpen}
        onOpenChange={setEditOpen}
        deal={deal}
        pipelineId={deal.pipeline_id}
        stages={stages}
        onSaved={fetchAllData}
      />
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Deal, CustomField, Task, Contact, Conversation, PipelineStage } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Calendar, CheckSquare, MessageSquare, Briefcase, FileText, Loader2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { DealForm } from "@/components/pipelines/deal-form";
import { Timeline } from "@/components/shared/timeline";

export default function DealDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  
  const [loading, setLoading] = useState(true);
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

    // 2. Fetch everything else in parallel
    const [
      stagesRes,
      fieldsRes,
      valuesRes,
      tasksRes,
      activitiesRes,
      convRes
    ] = await Promise.all([
      supabase.from('pipeline_stages').select('*').eq('pipeline_id', dealData.pipeline_id).order('position'),
      supabase.from('custom_fields').select('*').eq('module_name', 'deal').order('field_name'),
      supabase.from('deal_custom_values').select('*').eq('deal_id', id),
      supabase.from('tasks').select('*').eq('deal_id', id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'deal').eq('record_id', id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('*, contact:contacts(name, phone)').eq('contact_id', dealData.contact_id).order('last_message_at', { ascending: false }).limit(5)
    ]);

    if (stagesRes.data) setStages(stagesRes.data);

    // Custom Fields
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
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

    // Conversations from contact
    if (convRes.data) setConversations(convRes.data as Conversation[]);

    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!deal) return null;

  if (!deal) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg">
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
              {deal.status === "won" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                  <Check className="h-3 w-3" />
                  Won
                </span>
              )}
              {deal.status === "lost" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400 border border-red-500/20">
                  <X className="h-3 w-3" />
                  Lost
                </span>
              )}
              {deal.status === "open" && deal.stage && (
                 <Badge style={{ backgroundColor: deal.stage.color + '20', color: deal.stage.color, borderColor: deal.stage.color + '40' }} variant="outline">
                   {deal.stage.name}
                 </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
              <span className="font-semibold text-primary">{formatCurrency(deal.value, deal.currency)}</span>
              {deal.expected_close_date && <span className="flex items-center gap-1"><Calendar className="size-3" /> Close: {new Date(deal.expected_close_date).toLocaleDateString()}</span>}
              {deal.contact && (
                <Link href={`/contacts/${deal.contact_id}`} className="flex items-center gap-1 hover:underline text-foreground">
                  <Briefcase className="size-3" /> {deal.contact.name || deal.contact.phone}
                </Link>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deal.contact && (
            <Button onClick={() => router.push(`/inbox?phone=${deal.contact?.phone}`)} variant="outline" className="gap-2">
              <MessageSquare className="size-4" />
              Message Customer
            </Button>
          )}
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit Deal
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Deal Details</h3>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Title</p>
                <p className="font-medium">{deal.title}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Value</p>
                <p className="font-medium text-primary">{formatCurrency(deal.value, deal.currency)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Assigned To</p>
                <p className="font-medium">{deal.assignee?.full_name || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <p className="font-medium capitalize">{deal.status}</p>
              </div>
            </div>

            {deal.notes && (
              <div className="mt-6 pt-6 border-t border-border/50">
                <p className="text-sm text-muted-foreground mb-2">Deal Notes</p>
                <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
              </div>
            )}

            {customFields.length > 0 && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-4">Custom Fields</h3>
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
              </>
            )}
          </div>
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

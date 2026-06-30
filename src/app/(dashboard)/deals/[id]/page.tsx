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

export default function DealDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
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
      convRes
    ] = await Promise.all([
      supabase.from('pipeline_stages').select('*').eq('pipeline_id', dealData.pipeline_id).order('position'),
      supabase.from('custom_fields').select('*').eq('module_name', 'deal').order('field_name'),
      supabase.from('deal_custom_values').select('*').eq('deal_id', id),
      supabase.from('tasks').select('*').eq('deal_id', id).order('created_at', { ascending: false }),
      // A deal might be linked to a conversation in the future or via contact, for now just fetch if there's a direct link (if we add it)
      // Actually deals can have conversations linked? In the schema deals don't have conversation_id, but conversations might have deal_id.
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

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

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
              Message Contact
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
        <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden h-[calc(100vh-140px)] sticky top-6">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="size-4" />
              Timeline
            </h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-8">
            {/* Planned Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Planned</h4>
              {plannedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No upcoming tasks.</p>
              ) : (
                <div className="space-y-4">
                  {plannedTasks.map(task => (
                    <div key={task.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-primary before:ring-4 before:ring-card">
                      <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border last:hidden" />
                      <p className="text-sm font-medium">
                        <Link href={`/tasks/${task.id}`} className="hover:underline text-primary">{task.title}</Link>
                      </p>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{task.priority}</Badge>
                        {task.due_date && <span>Scheduled: {new Date(task.due_date).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Past</h4>
              {pastTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No past activities.</p>
              ) : (
                <div className="space-y-4 pb-4">
                  {pastTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((task, i, arr) => (
                    <div key={task.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                      {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2">
                          <CheckSquare className="size-3 text-green-500" />
                          <Link href={`/tasks/${task.id}`} className="hover:underline line-through text-muted-foreground">
                            {task.title}
                          </Link>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">Completed task • {new Date(task.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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

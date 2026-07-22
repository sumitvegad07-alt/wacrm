"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Task, CustomField } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Calendar, User, Clock, Bell, Briefcase, Users, MessageSquare, Pencil, Loader2, FileText, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskChecklistSection } from "@/components/tasks/task-checklist";
import { TaskCommentsSection } from "@/components/tasks/task-comments";
import { TaskAttachmentsSection } from "@/components/tasks/task-attachments";

function isOverdue(task: Task) {
  if (task.status === 'Completed' || task.status === 'Cancelled') return false;
  if (!task.due_date) return false;
  
  const now = new Date();
  const timeStr = task.due_time || '23:59:59';
  const dueDate = new Date(`${task.due_date}T${timeStr}`);
  
  return dueDate < now;
}

export default function TaskDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();

  const [task, setTask] = useState<Task | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetchTask();
  }, [id]);

  async function fetchTask() {
    setLoading(true);
    const [taskRes, fieldsRes, valuesRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*, assignee:profiles!tasks_assigned_user_id_fkey(*), contact:contacts!tasks_contact_id_fkey(*), deal:deals!tasks_deal_id_fkey(*), product:products!tasks_product_id_fkey(*), conversation:conversations!tasks_conversation_id_fkey(*)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("custom_fields").select("*").eq("module_name", "task").order("field_name"),
      supabase.from("task_custom_values").select("*").eq("task_id", id)
    ]);

    if (taskRes.error || !taskRes.data) {
      toast.error("Task not found");
      router.push("/tasks");
    } else {
      setTask(taskRes.data as Task);
      if (fieldsRes.data) setCustomFields(fieldsRes.data as CustomField[]);
      if (valuesRes.data) {
        const vals: Record<string, string> = {};
        valuesRes.data.forEach(v => {
          if (v.value) vals[v.custom_field_id] = v.value;
        });
        setCustomValues(vals);
      }
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!task) return null;

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
              {task.title}
              <Badge variant="outline" className="font-normal bg-card">
                {task.status}
              </Badge>
              {isOverdue(task) && (
                <Badge variant="destructive" className="font-normal">
                  Overdue
                </Badge>
              )}
              <Badge variant="outline" className="font-normal bg-card">
                {task.priority} Priority
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
              {task.due_date && <span className="flex items-center gap-1"><Calendar className="size-3" /> Scheduled: {new Date(task.due_date).toLocaleDateString()} {task.due_time && `at ${task.due_time.substring(0, 5)}`}</span>}
              <span className="flex items-center gap-1"><User className="size-3" /> {task.assignee ? (task.assignee.full_name || task.assignee.email) : "Unassigned"}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit Task
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          
          {(task.contact || task.deal || task.product || task.conversation) && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-lg font-semibold mb-4">Related To</h3>
              <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                {task.contact && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Customer</p>
                    <Link href={`/contacts/${task.contact.id}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                      <Users className="size-4" /> {task.contact.name || task.contact.phone}
                    </Link>
                  </div>
                )}
                {task.deal && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Deal</p>
                    <Link href={`/deals/${task.deal.id}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                      <Briefcase className="size-4" /> {task.deal.title}
                    </Link>
                  </div>
                )}
                {task.product && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Product</p>
                    <Link href={`/products/${task.product.id}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                      <Briefcase className="size-4" /> {task.product.name}
                    </Link>
                  </div>
                )}
                {task.conversation && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Conversation</p>
                    <Link href={`/inbox?c=${task.conversation.id}`} className="font-medium text-primary hover:underline flex items-center gap-1">
                      <MessageSquare className="size-4" /> View Conversation
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Description</h3>
            {task.description ? (
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            ) : (
              <p className="text-muted-foreground italic">No description provided.</p>
            )}

            {customFields.length > 0 && customFields.some(f => customValues[f.id]) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-4">Custom Fields</h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {customFields.map((field) => {
                    const val = customValues[field.id];
                    if (!val) return null;
                    return (
                      <div key={field.id}>
                        <p className="text-sm text-muted-foreground mb-1 capitalize">{field.field_name}</p>
                        {field.field_type === 'attachment' ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium flex items-center gap-1 break-all">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : (
                          <p className="font-medium break-words">{val}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          
          <div className="bg-card border border-border rounded-lg p-5">
            <TaskChecklistSection taskId={task.id} />
          </div>
          
          <div className="bg-card border border-border rounded-lg p-5">
            <TaskAttachmentsSection taskId={task.id} />
          </div>

        </div>

        {/* Right Column: Timeline (Comments) */}
        <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden h-[calc(100vh-140px)] sticky top-6">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold flex items-center gap-2">
              <MessageSquare className="size-4" />
              Comments & Activity
            </h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-0">
            <div className="p-4 h-full">
              <TaskCommentsSection taskId={task.id} />
            </div>
          </div>
        </div>
      </div>

      <TaskForm
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        onSaved={fetchTask}
      />
    </div>
  );
}

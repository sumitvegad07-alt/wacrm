"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, CalendarCheck, Phone, MapPin, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { TaskForm } from "@/components/tasks/task-form";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { isBefore, startOfToday } from "date-fns";

interface TaskListEmbeddedProps {
  contactId?: string;
  dealId?: string;
  conversationId?: string;
  leadId?: string;
}

export function TaskListEmbedded({ contactId, dealId, conversationId, leadId }: TaskListEmbeddedProps) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    fetchTasks();
  }, [contactId, dealId, conversationId, leadId]);

  async function fetchTasks() {
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email)")
      .order("created_at", { ascending: false });

    if (contactId) query = query.eq("contact_id", contactId);
    if (dealId) query = query.eq("deal_id", dealId);
    if (conversationId) query = query.eq("conversation_id", conversationId);
    if (leadId) query = query.eq("lead_id", leadId);

    const { data, error } = await query;
    if (!error && data) {
      setTasks(data as any);
    }
    setLoading(false);
  }

  async function toggleTaskStatus(task: Task, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    const newStatus = task.status === "Completed" ? "Pending" : "Completed";
    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", task.id);

    if (error) {
      toast.error("Failed to update task");
    } else {
      setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    }
  }

  function getTaskIcon(type?: string | null) {
    switch (type?.toLowerCase()) {
      case "call": return <Phone className="size-4 text-blue-500" />;
      case "visit": return <MapPin className="size-4 text-green-500" />;
      case "note": return <FileText className="size-4 text-yellow-500" />;
      default: return <CalendarCheck className="size-4 text-muted-foreground" />;
    }
  }

  function getPriorityColor(priority: string) {
    switch (priority?.toLowerCase()) {
      case "urgent": return "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20";
      case "high": return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20";
      case "low": return "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20";
      default: return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20";
    }
  }

  // Separate tasks into planned (not completed) and completed
  const plannedTasks = tasks.filter(t => t.status !== "Completed" && t.activity_type?.toLowerCase() !== "note");
  const notes = tasks.filter(t => t.activity_type?.toLowerCase() === "note");
  const completedTasks = tasks.filter(t => t.status === "Completed" && t.activity_type?.toLowerCase() !== "note");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-lg font-normal text-foreground">Timeline</h3>
        <Button size="sm" onClick={() => { setSelectedTask(null); setFormOpen(true); }} className="bg-primary/10 text-primary hover:bg-primary/20">
          ADD
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" />
          Loading...
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-border rounded-lg bg-card/50">
          <p className="text-sm text-muted-foreground mb-2">No activity logged.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* PLANNED SECTION */}
          {plannedTasks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/50 p-2 rounded">
                Planned
              </h4>
              <div className="divide-y divide-border">
                {plannedTasks.map((task) => {
                  const isOverdue = task.due_date && isBefore(new Date(task.due_date), startOfToday());
                  return (
                    <div
                      key={task.id}
                      onClick={() => { setSelectedTask(task); setFormOpen(true); }}
                      className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <div className="mt-0.5 shrink-0 bg-background border border-border p-1.5 rounded-md shadow-sm">
                        {getTaskIcon(task.activity_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium", isOverdue ? "text-red-500" : "text-foreground")}>
                          {task.activity_type && <span className="font-semibold text-muted-foreground mr-1">{task.activity_type}:</span>}
                          {task.description || task.title || "No description"}
                        </p>
                        <div className="mt-1 mb-1">
                           {task.priority && (
                              <Badge variant="outline" className={cn("text-[10px] font-semibold px-2 py-0 uppercase", getPriorityColor(task.priority))}>
                                {task.priority}
                              </Badge>
                           )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                          {task.due_date && <span className={cn(isOverdue && "text-red-500/80")}>{new Date(task.due_date).toLocaleDateString()} {task.due_time}</span>}
                          {task.assignee && (
                            <>
                              <span>|</span>
                              <span>to {task.assignee.full_name || task.assignee.email}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => toggleTaskStatus(task, e)}
                        className="shrink-0 size-5 border border-border rounded-sm hover:border-primary flex items-center justify-center transition-colors bg-background"
                      >
                         {/* Empty checkbox since it's planned */}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* NOTES SECTION */}
          {notes.length > 0 && (
            <div className="space-y-2">
              <div className="divide-y divide-border border-l-2 border-yellow-400 pl-2">
                {notes.map((note) => (
                   <div
                     key={note.id}
                     onClick={() => { setSelectedTask(note); setFormOpen(true); }}
                     className="py-3 hover:bg-muted/20 cursor-pointer"
                   >
                      <p className="text-sm text-foreground whitespace-pre-wrap">{note.description || note.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(note.created_at).toLocaleString()}</p>
                   </div>
                ))}
              </div>
            </div>
          )}

          {/* COMPLETED SECTION */}
          {completedTasks.length > 0 && (
             <div className="space-y-2">
              <div className="flex items-center justify-between bg-muted/50 p-2 rounded">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Past
                </h4>
                <button className="text-xs text-muted-foreground hover:text-foreground">filter</button>
              </div>
              <div className="divide-y divide-border opacity-75">
                {completedTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => { setSelectedTask(task); setFormOpen(true); }}
                    className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="mt-0.5 shrink-0 bg-background border border-border p-1.5 rounded-md shadow-sm opacity-50">
                      {getTaskIcon(task.activity_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground line-through decoration-muted-foreground/50">
                        {task.activity_type && <span className="font-semibold text-muted-foreground mr-1">{task.activity_type}:</span>}
                        {task.description || task.title || "No description"}
                      </p>
                      <div className="mt-1 mb-1">
                           {task.priority && (
                              <Badge variant="outline" className={cn("text-[10px] font-semibold px-2 py-0 uppercase opacity-60", getPriorityColor(task.priority))}>
                                {task.priority}
                              </Badge>
                           )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                        {task.due_date && <span>{new Date(task.due_date).toLocaleDateString()} {task.due_time}</span>}
                        {task.assignee && (
                          <>
                            <span>|</span>
                            <span>to {task.assignee.full_name || task.assignee.email}</span>
                          </>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2 italic bg-muted/50 p-1 rounded inline-block">
                        Completed on {task.updated_at ? new Date(task.updated_at).toLocaleString() : 'recently'}
                      </p>
                    </div>
                    <button 
                      onClick={(e) => toggleTaskStatus(task, e)}
                      className="shrink-0 size-5 border-none rounded-sm bg-green-500 text-white flex items-center justify-center transition-colors"
                    >
                       <CheckCircle2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        task={selectedTask}
        defaultContactId={contactId}
        defaultDealId={dealId}
        defaultConversationId={conversationId}
        defaultLeadId={leadId}
        onSaved={fetchTasks}
      />
    </div>
  );
}

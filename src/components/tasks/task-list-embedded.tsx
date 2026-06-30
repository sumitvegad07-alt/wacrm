"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { TaskForm } from "@/components/tasks/task-form";
import Link from "next/link";

interface TaskListEmbeddedProps {
  contactId?: string;
  dealId?: string;
  conversationId?: string;
}

export function TaskListEmbedded({ contactId, dealId, conversationId }: TaskListEmbeddedProps) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [contactId, dealId, conversationId]);

  async function fetchTasks() {
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email)")
      .order("created_at", { ascending: false });

    if (contactId) query = query.eq("contact_id", contactId);
    if (dealId) query = query.eq("deal_id", dealId);
    if (conversationId) query = query.eq("conversation_id", conversationId);

    const { data, error } = await query;
    if (!error && data) {
      setTasks(data as any);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <CheckSquare className="size-4 text-muted-foreground" />
          Tasks
        </h3>
        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="size-3.5 mr-1" />
          Add Task
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" />
          Loading tasks...
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground mb-2">No tasks linked.</p>
          <Button variant="link" size="sm" onClick={() => setFormOpen(true)}>
            Create one now
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/tasks/${task.id}`}
              className="block p-3 rounded-md border border-border bg-card hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {task.due_date ? `Due: ${new Date(task.due_date).toLocaleDateString()}` : "No due date"}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] py-0 font-normal">
                  {task.status}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultContactId={contactId}
        defaultDealId={dealId}
        defaultConversationId={conversationId}
        onSaved={fetchTasks}
      />
    </div>
  );
}

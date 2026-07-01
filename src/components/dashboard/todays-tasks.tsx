"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isPast, isToday } from "date-fns";
import { CheckCircle2, Circle, Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Task } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function TodaysTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    
    let cancelled = false;
    async function loadTasks() {
      const supabase = createClient();
      
      const todayString = format(new Date(), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .neq("status", "Completed")
        .neq("status", "Cancelled")
        .lte("due_date", todayString)
        .order("due_date", { ascending: true });
        
      if (cancelled) return;
      
      if (error) {
        console.error("Failed to load today's tasks:", error);
      } else {
        setTasks((data as Task[]) || []);
      }
      setLoading(false);
    }
    
    loadTasks();
    return () => { cancelled = true; };
  }, [user]);

  async function handleToggle(task: Task) {
    // Optimistic update
    setTasks(prev => prev.filter(t => t.id !== task.id));
    
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ status: "Completed" })
      .eq("id", task.id);
      
    if (error) {
      toast.error("Failed to mark task as completed");
      // Could revert the optimistic update here if needed
    } else {
      toast.success("Task completed!");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[300px] flex-col rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold text-foreground">Today's Tasks</h3>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[300px] flex-col rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Today's Tasks</h3>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
      
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {tasks.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center space-y-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-primary/40" />
            <p className="text-sm text-muted-foreground">You're all caught up for today!</p>
          </div>
        ) : (
          tasks.map(task => {
            const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date));
            return (
              <div
                key={task.id}
                className="group flex items-start gap-3 rounded-lg border border-border/50 bg-background/50 p-3 transition-colors hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => handleToggle(task)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                >
                  <Circle className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <Link href={`/tasks/${task.id}`} className="block focus:outline-none">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {task.title}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className={cn("h-3.5 w-3.5", isOverdue && "text-red-500")} />
                        <span className={cn(isOverdue && "font-medium text-red-500")}>
                          {isOverdue ? "Overdue" : "Today"} {task.due_time && `at ${task.due_time}`}
                        </span>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
      
      <div className="mt-4 pt-4 border-t border-border/50 text-center">
        <Link href="/tasks?new=true" className="text-sm text-primary hover:underline">
          + Add new task
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Plus, CalendarCheck, Phone, MapPin, FileText, CheckCircle2, Loader2, Link as LinkIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TaskForm } from "@/components/tasks/task-form";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { logModuleActivity } from "@/lib/activities";
import type { Task } from "@/types";
import { cn } from "@/lib/utils";
import { isBefore, startOfToday } from "date-fns";
import { DEFAULT_PERIOD, matchesPeriod, type TaskPeriod } from "@/lib/tasks/period-filter";
import { assigneeLabel, myStatus, progressLabel } from "@/lib/tasks/assignees";
import Link from "next/link";
import { PageLayout, PageHeader } from "@/components/shared";

// Extend Task type for this component to include joined relations
type FollowUpTask = Task & {
  contact?: { id: string; name: string };
  deal?: { id: string; title: string };
  lead?: { id: string; name: string };
  updated_at?: string;
};

export default function FollowUpsPage() {
  const { accountId, profile, profileLoading } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>(["Task", "Call", "Visit", "Meeting", "Follow up", "Note"]);
  
  // Opens on you, not the whole team — the screen is called My Activity.
  // "all" until the profile row settles, then replaced by the effect below.
  const [assignTo, setAssignTo] = useState("all");
  const [activityStatus, setActivityStatus] = useState("Undone");
  const [period, setPeriod] = useState<TaskPeriod>(DEFAULT_PERIOD);
  const [activityType, setActivityType] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    async function loadInitialData() {
      if (!accountId) return;
      
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      
      if (profileData) {
        const formattedProfiles = profileData.map(p => ({
          id: p.id,
          full_name: p.full_name || p.email || "Unknown User"
        }));
        setProfiles(formattedProfiles);
      }

      const { data: accountData } = await supabase
        .from("accounts")
        .select("settings")
        .eq("id", accountId)
        .single();

      if (accountData?.settings?.task_types && Array.isArray(accountData.settings.task_types)) {
        setTaskTypes(accountData.settings.task_types);
      }
    }
    loadInitialData();
  }, [accountId, supabase]);

  // Default the assignee filter to the signed-in user, once — after that the
  // user owns the control and a re-render must not drag it back.
  //
  // A user with no profile row falls through to "all" rather than showing an
  // empty screen with no explanation.
  const defaultedAssignee = useRef(false);
  useEffect(() => {
    if (profileLoading || defaultedAssignee.current) return;
    defaultedAssignee.current = true;
    if (profile?.id) setAssignTo(profile.id);
  }, [profileLoading, profile?.id]);

  useEffect(() => {
    // Waiting on the profile matters: firing before it settles would show the
    // whole team for a moment and then snap to one person.
    if (accountId && !profileLoading) {
      fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, profileLoading, assignTo, activityStatus, period, activityType, searchQuery, customStart, customEnd, priorityFilter]);

  async function fetchTasks() {
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), assignees:task_assignees(id, task_id, profile_id, status, completed_at, created_at, profile:profiles(full_name, email)), contact:contacts(id, name), deal:deals(id, title), lead:leads(id, name)")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    // Any assignee, not just the first. Someone added second to a task would
    // otherwise never see it on the screen named My Activity.
    if (assignTo && assignTo !== "all") {
      const { data: mine } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("profile_id", assignTo);
      const ids = (mine ?? []).map((r) => r.task_id);
      // No rows means no tasks — short-circuit rather than send `in ()`, which
      // would come back unfiltered and show the whole account's work.
      if (ids.length === 0) {
        setTasks([]);
        setLoading(false);
        return;
      }
      query = query.in("id", ids);
    }
    if (activityType && activityType !== "all") query = query.eq("activity_type", activityType);
    
    if (activityStatus === "Undone") {
      query = query.neq("status", "Completed");
    } else if (activityStatus === "Done") {
      query = query.eq("status", "Completed");
    }

    if (searchQuery) {
      query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
    }

    const { data, error } = await query;
    if (!error && data) {
      let filteredData = data as FollowUpTask[];
      
      filteredData = filteredData.filter((task) =>
        matchesPeriod(task.due_date, period, customStart, customEnd),
      );

      // Priority filter (default All).
      if (priorityFilter !== "All") {
        filteredData = filteredData.filter((task) => task.priority === priorityFilter);
      }

      setTasks(filteredData);
    }
    setLoading(false);
  }

  const handleSearch = () => {
    fetchTasks();
  };

  const handleAddActivity = () => {
    setSelectedTask(null);
    setFormOpen(true);
  };

  async function toggleTaskStatus(task: FollowUpTask, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    const mine = myStatus(task.assignees ?? [], profile?.id);
    const newStatus = (mine ?? task.status) === "Completed" ? "Pending" : "Completed";
    const timestamp = new Date().toISOString();

    // When you are one of the assignees you complete YOUR row, and the rollup
    // trigger decides whether that finishes the task. Writing tasks.status
    // here as well would complete it for everyone else too.
    //
    // When the task is not assigned to you at all there is no row to tick, so
    // the old behaviour stands and the task's own status is set.
    const { error } = mine !== null && profile?.id
      ? await supabase
          .from("task_assignees")
          .update({
            status: newStatus,
            completed_at: newStatus === "Completed" ? timestamp : null,
          })
          .eq("task_id", task.id)
          .eq("profile_id", profile.id)
      : await supabase
          .from("tasks")
          .update({ status: newStatus, updated_at: timestamp })
          .eq("id", task.id);

    if (error) {
      toast.error("Failed to update task");
    } else {
      // Refetch rather than patch the row in place. With several people on a
      // task, ticking your own box may or may not change the task's own
      // status — that is the rollup trigger's call, not something the client
      // can work out without duplicating it.
      await fetchTasks();

      toast.success(
        newStatus === "Completed"
          ? mine !== null
            ? "Marked done for you"
            : "Task completed"
          : "Task restored",
      );
      
      // Log to module activities
      const msg = `Task '${task.description || task.title || task.activity_type}' marked as ${newStatus.toLowerCase()}`;
      if (task.contact_id) await logModuleActivity(supabase, { moduleName: "contact", recordId: task.contact_id, action: "status_changed", message: msg });
      if (task.deal_id) await logModuleActivity(supabase, { moduleName: "deal", recordId: task.deal_id, action: "status_changed", message: msg });
      if (task.lead_id) await logModuleActivity(supabase, { moduleName: "lead", recordId: task.lead_id, action: "status_changed", message: msg });
      if (task.product_id) await logModuleActivity(supabase, { moduleName: "product", recordId: task.product_id, action: "status_changed", message: msg });
      if (task.quotation_id) await logModuleActivity(supabase, { moduleName: "quotation", recordId: task.quotation_id, action: "status_changed", message: msg });
    }
  }

  async function deleteTask(task: FollowUpTask, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this activity?")) return;

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      toast.error("Failed to delete");
    } else {
      setTasks(tasks.filter(t => t.id !== task.id));
      toast.success("Task deleted");
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
      case "urgent": return "bg-red-600 text-white shadow-sm border-transparent";
      case "high": return "bg-orange-600 text-white shadow-sm border-transparent";
      case "low": return "bg-green-600 text-white shadow-sm border-transparent";
      default: return "bg-slate-600 text-white shadow-sm border-transparent";
    }
  }

  const TaskItem = ({ task }: { task: FollowUpTask }) => {
    const rows = task.assignees ?? [];
    const mine = myStatus(rows, profile?.id);
    // The tick shows YOUR state when the task is yours, and the task's own
    // rolled-up state when you are only looking at someone else's work.
    const isCompleted = (mine ?? task.status) === "Completed";
    const progress = progressLabel(rows);
    const isOverdue = task.due_date && isBefore(new Date(task.due_date), startOfToday()) && !isCompleted;
    const isNote = task.activity_type?.toLowerCase() === "note";
    
    return (
      <div
        onClick={() => { setSelectedTask(task); setFormOpen(true); }}
        className={cn(
          "flex items-start gap-4 p-4 hover:bg-muted/30 transition-colors cursor-pointer",
          isCompleted && "opacity-75 bg-muted/10",
          isNote && "border-l-4 border-l-yellow-400"
        )}
      >
        <div className="mt-1 shrink-0 bg-background border border-border p-2 rounded-lg shadow-sm">
          {getTaskIcon(task.activity_type)}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <p className={cn(
              "text-base font-medium",
              isCompleted ? "line-through text-muted-foreground" : (isOverdue ? "text-red-500 font-semibold" : "text-foreground"),
              isNote && "whitespace-pre-wrap"
            )}>
              {task.activity_type && !isNote && <span className="font-semibold text-muted-foreground mr-2">{task.activity_type}:</span>}
              {task.description || task.title || "No description provided"}
            </p>
            
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button 
                onClick={(e) => deleteTask(task, e)}
                className="size-6 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors"
                title="Delete Activity"
              >
                <Trash2 className="size-4" />
              </button>
              
              {!isNote && (
                <button
                  onClick={(e) => toggleTaskStatus(task, e)}
                  title={
                    mine !== null
                      ? isCompleted
                        ? "Mark as pending for you"
                        : "Mark as done for you"
                      : isCompleted
                        ? "Mark as pending"
                        : "Mark as completed"
                  }
                  className={cn(
                    "size-6 border-2 rounded flex items-center justify-center transition-colors",
                    isCompleted
                      ? "bg-green-500 text-white border-green-500"
                      : "bg-background border-muted-foreground/70 text-muted-foreground/50 hover:border-green-500 hover:text-green-600 hover:bg-green-500/10"
                  )}
                >
                  <CheckCircle2 className="size-4" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
            {!isNote && task.priority && (
              <Badge variant="outline" className={cn("text-[10px] font-semibold px-2 py-0 uppercase", getPriorityColor(task.priority))}>
                {task.priority}
              </Badge>
            )}

            {task.due_date && (
              <span className={cn(isOverdue && !isCompleted && "text-red-500/80")}>
                {isOverdue && !isCompleted && <span className="font-medium mr-1">[Overdue]</span>}
                {new Date(task.due_date).toLocaleDateString()} {task.due_time}
              </span>
            )}
            
            {task.assignee && (
              <>
                {task.due_date && <span>•</span>}
                <span>
                  User:{" "}
                  {/* "Priya +2" when a task is shared. Falls back to the single
                      assignee relation for a task whose rows have not loaded. */}
                  {rows.length > 0
                    ? assigneeLabel(
                        rows.map((r) => r.profile?.full_name || r.profile?.email || "Unknown"),
                      )
                    : task.assignee.full_name || task.assignee.email}
                </span>
              </>
            )}

            {/* Makes it obvious the task lives on after you tick your own box. */}
            {progress && (
              <>
                <span>•</span>
                <span className={cn("font-medium", mine === "Completed" && "text-green-600")}>
                  {progress}
                </span>
              </>
            )}
            
            {/* Linked Record Links */}
            {(task.contact || task.deal || task.lead) && (
              <div className="flex items-center gap-1 text-primary bg-primary/10 px-2 py-0.5 rounded text-xs ml-2" onClick={(e) => e.stopPropagation()}>
                <LinkIcon className="size-3" />
                {task.contact && <Link href={`/contacts/${task.contact.id}`} className="hover:underline">{task.contact.name}</Link>}
                {task.deal && <Link href={`/deals/${task.deal.id}`} className="hover:underline">{task.deal.title}</Link>}
                {task.lead && <Link href={`/leads/${task.lead.id}`} className="hover:underline">{task.lead.name}</Link>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="Follow-ups & Activities"
        subtitle="Manage all your scheduled tasks and activities."
        actions={
          <Button onClick={handleAddActivity} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="size-4 mr-2" /> Schedule Activity
          </Button>
        }
      />

      <div className="flex flex-col gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-full lg:w-64 shrink-0">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search activities..."
                className="pl-9 bg-background border-border h-10"
              />
            </div>
          </div>

          <div className="w-48">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Users</Label>
            <SearchableSelect
              options={[{ label: "All Users", value: "all" }, ...profiles.map(p => ({ label: p.full_name, value: p.id }))]}
              value={assignTo}
              onChange={setAssignTo}
              placeholder="Users"
              className="h-10 bg-background"
            />
          </div>

          <div className="w-40">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Type</Label>
            <Select value={activityType} onValueChange={(val) => setActivityType(val || "all")}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {taskTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Period</Label>
            <Select value={period} onValueChange={(val) => setPeriod((val || DEFAULT_PERIOD) as TaskPeriod)}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Periods</SelectItem>
                <SelectItem value="Overdue" className="text-red-500 font-medium">Overdue</SelectItem>
                <SelectItem value="Today">Today</SelectItem>
                <SelectItem value="Tomorrow">Tomorrow</SelectItem>
                <SelectItem value="This Week">This Week</SelectItem>
                <SelectItem value="This Month">This Month</SelectItem>
                <SelectItem value="Custom Range">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-36">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Status</Label>
            <Select value={activityStatus} onValueChange={(val) => setActivityStatus(val || "All")}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                <SelectItem value="Undone">Undone</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-36">
            <Label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Priority</Label>
            <Select value={priorityFilter} onValueChange={(val) => setPriorityFilter(val || "All")}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Priorities</SelectItem>
                <SelectItem value="Urgent">Urgent</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSearch} variant="secondary" className="ml-auto h-10 mt-6 lg:mt-0">
            Apply
          </Button>
        </div>
        
        {period === "Custom Range" && (
          <div className="flex items-center gap-2 mt-2 pt-4 border-t border-border">
            <div className="text-sm text-muted-foreground mr-2">Select Range:</div>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-auto h-9" />
            <span className="text-muted-foreground">to</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-auto h-9" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden space-y-6">
        {loading ? (
           <div className="flex flex-col items-center justify-center h-64 text-muted-foreground bg-card rounded-xl border border-border">
             <Loader2 className="size-8 animate-spin mb-4 text-primary" />
             <p>Loading activities...</p>
           </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center border-dashed rounded-xl p-6 text-center min-h-[400px] bg-card">
            <h2 className="text-xl font-medium text-foreground mb-2">No activity found</h2>
            <p className="text-muted-foreground mb-6 max-w-sm">You don't have any follow-ups matching these filters.</p>
            <Button onClick={handleAddActivity}>
              <Plus className="size-4 mr-2" /> Schedule an Activity
            </Button>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {tasks.map(task => <TaskItem key={task.id} task={task} />)}
            </div>
          </div>
        )}
      </div>

      <TaskForm open={formOpen} onOpenChange={setFormOpen} task={selectedTask} onSaved={fetchTasks} />
    </PageLayout>
  );
}

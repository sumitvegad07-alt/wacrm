'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, CheckSquare, FileText, CheckCircle, XCircle, Copy, FilePlus2, Plus, MessageSquare, Phone, MapPin, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskForm } from '@/components/tasks/task-form';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isBefore, startOfToday } from 'date-fns';
import { logModuleActivity } from '@/lib/activities';
import { useAuth } from '@/hooks/use-auth';

export interface TimelineEvent {
  id: string;
  type: 'task' | 'note' | 'activity' | 'changelog';
  date: Date;
  data: any;
}

interface TimelineProps {
  moduleName: 'contact' | 'deal' | 'quotation' | 'product' | 'lead' | 'expense';
  recordId: string;
  tasks: any[];
  notes?: any[];
  activities?: any[];
  onRefresh: () => void;
}

export function Timeline({ moduleName, recordId, tasks, notes = [], activities = [], onRefresh }: TimelineProps) {
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [filter, setFilter] = useState('all'); // all, activities, notes, changelog

  const supabase = createClient();
  const { user } = useAuth();

  const toggleTaskStatus = async (task: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    const timestamp = new Date().toISOString();
    
    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus, updated_at: timestamp })
      .eq('id', task.id);

    if (error) {
      toast.error('Failed to update task');
    } else {
      toast.success(newStatus === 'Completed' ? 'Task completed' : 'Task restored');
      await logModuleActivity(supabase, {
        moduleName,
        recordId,
        action: 'status_changed',
        message: `Task '${task.title || task.activity_type}' marked as ${newStatus.toLowerCase()}`
      });
      onRefresh();
    }
  };

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled' && t.activity_type?.toLowerCase() !== 'note');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');
  const taskNotes = tasks.filter(t => t.activity_type?.toLowerCase() === 'note');

  const getActionIcon = (action: string) => {
    if (action.includes('created') || action.includes('generated')) return <FilePlus2 className="size-3 text-primary" />;
    if (action.includes('approved') || action.includes('accepted')) return <CheckCircle className="size-3 text-green-500" />;
    if (action.includes('rejected')) return <XCircle className="size-3 text-red-500" />;
    if (action.includes('version')) return <Copy className="size-3 text-blue-500" />;
    if (action === 'updated' || action === 'status_changed') return <CheckSquare className="size-3 text-amber-500" />;
    return <MessageSquare className="size-3 text-muted-foreground" />;
  };

  const getActionMessage = (activity: any) => {
    if (activity.message) {
      return <span>{activity.message}</span>;
    }
    
    // Default fallback messages
    const action = activity.action;
    if (action === 'status_changed') {
      return `Status updated to ${activity.details?.new_status?.toLowerCase() || 'a new status'}`;
    }
    if (action === 'created') return `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} generated.`;
    if (action === 'updated') return `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} updated.`;
    return action;
  };

  function getTaskIcon(type?: string) {
    switch (type?.toLowerCase()) {
      case "call": return <Phone className="size-4 text-blue-500" />;
      case "visit": return <MapPin className="size-4 text-green-500" />;
      case "note": return <FileText className="size-4 text-yellow-500" />;
      default: return <Calendar className="size-4 text-muted-foreground" />;
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

  // Process activities to categorize into 'activity' (business logic) vs 'changelog' (field updates)
  const processedActivities = activities.map(a => ({
    type: a.action === 'updated' ? 'changelog' : 'activity',
    date: new Date(a.created_at),
    data: a
  }));

  const combinedPast: TimelineEvent[] = [
    ...notes.map(n => ({ id: `n-${n.id}`, type: 'note' as const, date: new Date(n.created_at), data: n })),
    ...taskNotes.map(n => ({ id: `tn-${n.id}`, type: 'note' as const, date: new Date(n.created_at), data: { note_text: n.description || n.title } })),
    ...pastTasks.map(t => ({ id: `t-${t.id}`, type: 'task' as const, date: new Date(t.created_at), data: t })),
    ...processedActivities.map(a => ({ id: `a-${a.data.id}`, type: a.type as 'changelog' | 'activity', date: a.date, data: a.data }))
  ];

  combinedPast.sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredPast = combinedPast.filter(event => {
    if (filter === 'all') return true;
    if (filter === 'activities' && (event.type === 'activity' || event.type === 'task')) return true;
    if (filter === 'notes' && event.type === 'note') return true;
    if (filter === 'changelog' && event.type === 'changelog') return true;
    return false;
  });

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden h-[calc(100vh-140px)] sticky top-6">
      <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2">
          <Calendar className="size-4" />
          Timeline
        </h3>
        <Button variant="outline" size="sm" onClick={() => { setSelectedTask(null); setTaskFormOpen(true); }} className="h-7 text-xs px-2 gap-1">
          <Plus className="size-3" />
          ADD
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Planned Section */}
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 bg-muted/50 p-2 rounded">
            Planned
          </h4>
          {plannedTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground italic px-2">
              <p>You don't have any upcoming activity.</p>
              <button 
                onClick={() => { setSelectedTask(null); setTaskFormOpen(true); }}
                className="text-primary hover:underline not-italic mt-1 text-xs font-medium"
              >
                Schedule activity
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {plannedTasks.map((task) => {
                const isOverdue = task.due_date && isBefore(new Date(task.due_date), startOfToday());
                return (
                  <div key={task.id} className="flex items-start gap-3 py-3 hover:bg-muted/30 transition-colors px-2 rounded-md">
                    <div className="mt-0.5 shrink-0 bg-background border border-border p-1.5 rounded-md shadow-sm">
                      {getTaskIcon(task.activity_type)}
                    </div>
                    <div 
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => { setSelectedTask(task); setTaskFormOpen(true); }}
                    >
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
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Past Section */}
        <div>
          <div className="flex items-center justify-between mb-3 bg-muted/50 p-2 rounded">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Past
            </h4>
            <DropdownMenu>
              <DropdownMenuTrigger className="text-xs text-muted-foreground hover:text-foreground">
                filter
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={filter} onValueChange={setFilter}>
                  <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="activities">Activities</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="notes">Notes</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="changelog">Changelog</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {filteredPast.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-2">No past activities found.</p>
          ) : (
            <div className="divide-y divide-border opacity-75">
              {filteredPast.map((event) => {
                const isTask = event.type === 'task';
                const isNote = event.type === 'note';
                
                if (isNote) {
                  return (
                    <div key={event.id} className="py-3 px-2">
                      <div className="bg-muted/40 rounded p-3 text-sm border border-border/50">
                        <p className="font-semibold text-xs text-muted-foreground mb-1">Note</p>
                        <p className="whitespace-pre-wrap">{event.data.note_text}</p>
                        <p className="text-[10px] text-muted-foreground mt-2">{event.date.toLocaleString()}</p>
                      </div>
                    </div>
                  );
                }

                if (isTask) {
                  return (
                    <div key={event.id} className="flex items-start gap-3 py-3 hover:bg-muted/30 transition-colors px-2 rounded-md">
                      <div className="mt-0.5 shrink-0 bg-background border border-border p-1.5 rounded-md shadow-sm opacity-50">
                        {getTaskIcon(event.data.activity_type)}
                      </div>
                      <div 
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => { setSelectedTask(event.data); setTaskFormOpen(true); }}
                      >
                        <p className="text-sm font-medium text-foreground line-through decoration-muted-foreground/50">
                          {event.data.activity_type && <span className="font-semibold text-muted-foreground mr-1">{event.data.activity_type}:</span>}
                          {event.data.description || event.data.title || "No description"}
                        </p>
                        <div className="mt-1 mb-1">
                             {event.data.priority && (
                                <Badge variant="outline" className={cn("text-[10px] font-semibold px-2 py-0 uppercase opacity-60", getPriorityColor(event.data.priority))}>
                                  {event.data.priority}
                                </Badge>
                             )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                          {event.data.due_date && <span>{new Date(event.data.due_date).toLocaleDateString()} {event.data.due_time}</span>}
                          {event.data.assignee && (
                            <>
                              <span>|</span>
                              <span>to {event.data.assignee.full_name || event.data.assignee.email}</span>
                            </>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2 italic bg-muted/50 p-1 rounded inline-block">
                          Completed on {event.data.updated_at ? new Date(event.data.updated_at).toLocaleString() : 'recently'}
                          {event.data.assignee && ` (Assigned to ${event.data.assignee.full_name || event.data.assignee.email})`}
                        </p>
                      </div>
                      <button 
                        onClick={(e) => toggleTaskStatus(event.data, e)}
                        className="shrink-0 size-5 border-none rounded-sm bg-green-500 text-white flex items-center justify-center transition-colors"
                      >
                         <CheckCircle2 className="size-4" />
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={event.id} className="relative pl-6 py-3 before:absolute before:left-1.5 before:top-[18px] before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                    <div className="text-sm px-2">
                      <p className="font-medium flex items-center gap-2 text-foreground">
                        {getActionIcon(event.data.action)}
                        {getActionMessage(event.data)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        by <span className="font-medium">{event.data.user?.full_name || 'System'}</span> on {event.date.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      <TaskForm
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        task={selectedTask}
        defaultContactId={moduleName === 'contact' ? recordId : undefined}
        defaultDealId={moduleName === 'deal' ? recordId : undefined}
        defaultQuotationId={moduleName === 'quotation' ? recordId : undefined}
        defaultLeadId={moduleName === 'lead' ? recordId : undefined}
        defaultExpenseId={moduleName === 'expense' ? recordId : undefined}
        onSaved={onRefresh}
      />
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, CheckSquare, FileText, CheckCircle, XCircle, Copy, FilePlus2, Plus, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskForm } from '@/components/tasks/task-form';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface TimelineEvent {
  id: string;
  type: 'task' | 'note' | 'activity' | 'changelog';
  date: Date;
  data: any;
}

interface TimelineProps {
  moduleName: 'contact' | 'deal' | 'quotation' | 'product';
  recordId: string;
  tasks: any[];
  notes?: any[];
  activities?: any[];
  onRefresh: () => void;
}

export function Timeline({ moduleName, recordId, tasks, notes = [], activities = [], onRefresh }: TimelineProps) {
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // all, activities, notes, changelog

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

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

  // Process activities to categorize into 'activity' (business logic) vs 'changelog' (field updates)
  const processedActivities = activities.map(a => ({
    type: a.action === 'updated' ? 'changelog' : 'activity',
    date: new Date(a.created_at),
    data: a
  }));

  const combinedPast: TimelineEvent[] = [
    ...notes.map(n => ({ id: `n-${n.id}`, type: 'note' as const, date: new Date(n.created_at), data: n })),
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
        <Button variant="outline" size="sm" onClick={() => setTaskFormOpen(true)} className="h-7 text-xs px-2 gap-1">
          <Plus className="size-3" />
          ADD
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        {/* Planned Section */}
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Planned</h4>
          {plannedTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">
              <p>You don't have any upcoming activity.</p>
              <button 
                onClick={() => setTaskFormOpen(true)}
                className="text-primary hover:underline not-italic mt-1 text-xs font-medium"
              >
                Schedule activity
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {plannedTasks.map((task, i, arr) => (
                <div key={task.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-primary before:ring-4 before:ring-card">
                  {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
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
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Past</h4>
            
            <DropdownMenu>
              <DropdownMenuTrigger className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground">
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
            <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No past activities found.</p>
          ) : (
            <div className="space-y-4 pb-4">
              {filteredPast.map((event, i, arr) => {
                const isTask = event.type === 'task';
                const isNote = event.type === 'note';
                
                return (
                  <div key={event.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                    {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
                    
                    {isNote ? (
                      <div className="bg-muted/40 rounded p-3 text-sm border border-border/50 mt-1">
                        <p className="font-semibold text-xs text-muted-foreground mb-1">Note Added</p>
                        <p className="whitespace-pre-wrap">{event.data.note_text}</p>
                        <p className="text-[10px] text-muted-foreground mt-2">{event.date.toLocaleString()}</p>
                      </div>
                    ) : isTask ? (
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2">
                          <CheckSquare className="size-3 text-green-500" />
                          <Link href={`/tasks/${event.data.id}`} className="hover:underline line-through text-muted-foreground">
                            {event.data.title}
                          </Link>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">Completed task • {event.date.toLocaleString()}</p>
                      </div>
                    ) : (
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2 text-foreground">
                          {getActionIcon(event.data.action)}
                          {getActionMessage(event.data)}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          by <span className="font-medium">{event.data.user?.full_name || 'System'}</span> on {event.date.toLocaleString()}
                        </p>
                      </div>
                    )}
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
        defaultContactId={moduleName === 'contact' ? recordId : undefined}
        defaultDealId={moduleName === 'deal' ? recordId : undefined}
        defaultQuotationId={moduleName === 'quotation' ? recordId : undefined}
        onSaved={onRefresh}
      />
    </div>
  );
}

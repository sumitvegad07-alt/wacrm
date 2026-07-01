'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Calendar, FileText, CheckCircle, XCircle, Copy, FilePlus2, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { TaskForm } from '@/components/tasks/task-form';
import { Button } from '@/components/ui/button';

interface QuotationTimelineProps {
  quotationId: string;
}

export function QuotationTimeline({ quotationId }: QuotationTimelineProps) {
  const supabase = createClient();
  const [activities, setActivities] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const fetchActivities = async () => {
      const [actRes, taskRes] = await Promise.all([
        supabase
          .from('quotation_activities')
          .select('*')
          .eq('quotation_id', quotationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tasks')
          .select('*')
          .eq('quotation_id', quotationId)
          .order('created_at', { ascending: false })
      ]);

      if (!actRes.error && actRes.data) {
        setActivities(actRes.data);
      }
      if (!taskRes.error && taskRes.data) {
        setTasks(taskRes.data);
      }
      setLoading(false);
    };

  useEffect(() => {
    fetchActivities();
  }, [quotationId, supabase]);

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground animate-pulse">Loading timeline...</div>;
  }

  const getActionIcon = (action: string) => {
    if (action.includes('created')) return <FilePlus2 className="size-3 text-primary" />;
    if (action.includes('approved') || action.includes('accepted')) return <CheckCircle className="size-3 text-green-500" />;
    if (action.includes('rejected')) return <XCircle className="size-3 text-red-500" />;
    if (action.includes('version')) return <Copy className="size-3 text-blue-500" />;
    return <CheckSquare className="size-3 text-muted-foreground" />;
  };

  const getActionMessage = (activity: any) => {
    const action = activity.action;
    if (action === 'status_changed') {
      return `Quotation moved to ${activity.details?.new_status?.toLowerCase() || 'a new status'}`;
    }
    if (action === 'created') return 'Quotation generated';
    if (action === 'updated') return 'Quotation updated';
    if (action === 'versioned') {
      if (activity.details?.new_number && activity.details?.new_id) {
        return (
          <span>
            Generated new version <Link href={`/quotations/${activity.details.new_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{activity.details.new_number}</Link>
          </span>
        );
      }
      return `New version v${activity.details?.new_version || ''} created`;
    }
    if (action === 'created_as_version') {
      if (activity.details?.new_number && activity.details?.original_number && activity.details?.original_id) {
        return (
          <span>
            Quotation {activity.details.new_number} generated from <Link href={`/quotations/${activity.details.original_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">Quotation {activity.details.original_number}</Link>
          </span>
        );
      }
      return `Created as a new version`;
    }
    if (action === 'cloned') return `Cloned from another quotation`;
    return action;
  };

  const plannedTasks = tasks.filter(t => t.status !== 'Completed');
  const pastTasks = tasks.filter(t => t.status === 'Completed');
  
  // Combine activities and past tasks
  const combinedPast = [
    ...activities.map(a => ({ ...a, _type: 'activity', _date: new Date(a.created_at).getTime() })),
    ...pastTasks.map(t => ({ ...t, _type: 'task', _date: new Date(t.created_at).getTime() }))
  ].sort((a, b) => b._date - a._date);

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

        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Past</h4>
          {combinedPast.length === 0 ? (
            <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No past activities.</p>
          ) : (
            <div className="space-y-4 pb-4">
              {combinedPast.map((item, i, arr) => {
                const isTask = item._type === 'task';
                
                return (
                  <div key={isTask ? `t-${item.id}` : `a-${item.id}`} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                    {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
                    
                    {isTask ? (
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2">
                          <CheckSquare className="size-3 text-green-500" />
                          <Link href={`/tasks/${item.id}`} className="hover:underline line-through text-muted-foreground">
                            {item.title}
                          </Link>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">Completed task • {new Date(item.created_at).toLocaleString()}</p>
                      </div>
                    ) : (
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2 text-foreground">
                          {getActionIcon(item.action)}
                          {getActionMessage(item)}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          by <span className="font-medium">System</span> on {new Date(item.created_at).toLocaleString()}
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
        defaultQuotationId={quotationId}
        onSaved={fetchActivities}
      />
    </div>
  );
}

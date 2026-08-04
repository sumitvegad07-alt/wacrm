'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Task, CustomField } from '@/types';
import { useCan } from '@/hooks/use-can';

function isOverdue(task: any) {
  if (task.status === 'Completed' || task.status === 'Cancelled') return false;
  if (!task.due_date) return false;
  
  const now = new Date();
  const timeStr = task.due_time || '23:59:59';
  const dueDate = new Date(`${task.due_date}T${timeStr}`);
  
  return dueDate < now;
}

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  CheckSquare,
  Upload,
  SlidersHorizontal,
} from 'lucide-react';
import { TaskForm } from '@/components/tasks/task-form';
import { ImportTasksModal } from '@/components/tasks/import-tasks-modal';
import { Checkbox } from '@/components/ui/checkbox';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from '@/components/shared';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const PRIORITY_COLORS: Record<string, string> = {
  Low: 'bg-slate-600 text-white shadow-sm border-transparent',
  Medium: 'bg-blue-600 text-white shadow-sm border-transparent',
  High: 'bg-orange-600 text-white shadow-sm border-transparent',
  Urgent: 'bg-red-600 text-white shadow-sm border-transparent',
};

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-600 text-white shadow-sm border-transparent',
  'In Progress': 'bg-blue-600 text-white shadow-sm border-transparent',
  Waiting: 'bg-amber-600 text-white shadow-sm border-transparent',
  Completed: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Cancelled: 'bg-red-600 text-white shadow-sm border-transparent',
};

export default function TasksPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEditSettings = useCan('edit-settings');

  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // DataTable state
  const [globalSearch, setGlobalSearch] = useState('');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Lookups
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    
    const [{ data: tasksData }, { data: fieldsData }] = await Promise.all([
      supabase.from('tasks').select('*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), contact:contacts!tasks_contact_id_fkey(name, phone), deal:deals!tasks_deal_id_fkey(title)').order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('module_name', 'task')
    ]);

    setCustomFields(fieldsData || []);

    let enhancedTasks = tasksData || [];
    if (tasksData && tasksData.length > 0) {
      const taskIds = tasksData.map(t => t.id);
      const { data: valuesData } = await supabase
        .from('task_custom_values')
        .select('*')
        .in('task_id', taskIds);

      if (valuesData && valuesData.length > 0) {
        enhancedTasks = tasksData.map(task => {
          const taskValues = valuesData.filter((v: any) => v.task_id === task.id);
          const customData: any = {};
          taskValues.forEach((v: any) => {
            customData[`cf_${v.custom_field_id}`] = v.value;
          });
          return { ...task, ...customData };
        });
      }
    }

    setTasks(enhancedTasks);
    setLoading(false);
    setSelectedTaskIds(new Set());
  }, [supabase]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (searchParams.get("new") === "true") {
      router.push('/tasks/new');
    }
  }, [searchParams, router]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase.from('tasks').delete().eq('id', deleteTarget.id);

    if (error) toast.error('Failed to delete task');
    else { toast.success('Task deleted'); fetchTasks(); }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleQuickComplete(task: any, e: React.MouseEvent) {
    e.stopPropagation();
    const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id);
    if (!error) {
      toast.success(newStatus === 'Completed' ? 'Task marked as completed' : 'Task reopened');
      fetchTasks();
    } else {
      toast.error('Failed to update task');
    }
  }

  async function handleBulkStatusChange(newStatus: string) {
    if (selectedTaskIds.size === 0) return;
    setBulkActionLoading(true);
    const ids = Array.from(selectedTaskIds);
    const { error } = await supabase.from('tasks').update({ status: newStatus }).in('id', ids);
    if (!error) {
      toast.success(`Updated ${ids.length} tasks`);
      fetchTasks();
    } else {
      toast.error('Failed to update tasks');
    }
    setBulkActionLoading(false);
  }

  async function handleBulkDelete() {
    if (selectedTaskIds.size === 0) return;
    setBulkActionLoading(true);
    const ids = Array.from(selectedTaskIds);
    const { error } = await supabase.from('tasks').delete().in('id', ids);
    if (!error) {
      toast.success(`Deleted ${ids.length} tasks`);
      fetchTasks();
    } else {
      toast.error('Failed to delete tasks');
    }
    setBulkActionLoading(false);
  }

  const columns: ColumnDef<any>[] = [
    {
      id: "title",
      label: "Title",
      type: "text",
      render: (task) => (
        <div className="flex items-center gap-3">
          <button 
            onClick={(e) => handleQuickComplete(task, e)}
            className={`size-5 shrink-0 rounded-full border flex items-center justify-center ${task.status === 'Completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-muted-foreground/30 text-transparent hover:border-emerald-500 hover:text-emerald-500/20'}`}
          >
            <CheckSquare className="size-3.5" />
          </button>
          <span className={`font-medium ${task.status === 'Completed' ? 'line-through opacity-50' : ''}`}>
            {task.title}
          </span>
        </div>
      )
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: Object.keys(STATUS_COLORS).map(s => ({ label: s, value: s })),
      render: (task) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status.toLowerCase()} label={task.status} />
          {isOverdue(task) && (
            <StatusBadge status="overdue" label="Overdue" />
          )}
        </div>
      )
    },
    {
      id: "priority",
      label: "Priority",
      type: "select",
      options: Object.keys(PRIORITY_COLORS).map(s => ({ label: s, value: s })),
      render: (task) => (
        <StatusBadge status={task.priority.toLowerCase()} label={task.priority} />
      )
    },
    {
      id: "assignee",
      label: "Assigned To",
      type: "text",
      render: (task) => <span className="text-muted-foreground text-sm">{task.assignee?.full_name || task.assignee?.email || <span className="italic">Unassigned</span>}</span>
    },
    {
      id: "due_date",
      label: "Scheduled Date",
      type: "date",
      render: (task) => (
        <span className="text-muted-foreground text-sm">
          {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
          {task.due_time ? ` at ${task.due_time.substring(0, 5)}` : ''}
        </span>
      )
    },
    {
      id: "linked_to",
      label: "Linked To",
      type: "text",
      render: (task) => (
        <div className="flex flex-col gap-1">
          {task.contact && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border w-fit">
              Contact: {task.contact.name || task.contact.phone}
            </span>
          )}
          {task.deal && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border w-fit">
              Deal: {task.deal.title}
            </span>
          )}
          {!task.contact && !task.deal && <span className="text-muted-foreground text-xs">-</span>}
        </div>
      )
    },
    {
      id: "actions",
      label: "",
      visibleByDefault: true,
      render: (task) => (
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" />}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 border-border bg-popover">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditTask(task); setFormOpen(true); }}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem className="text-red-500 focus:text-red-600 focus:bg-red-500/10" onClick={(e) => { e.stopPropagation(); setDeleteTarget(task); setDeleteConfirmOpen(true); }}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, tasks);
  }, [columns, customFields, tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Hide Completed
      if (hideCompleted && (task.status === 'Completed' || task.status === 'Cancelled')) return false;

      // Global search (title, description, and searchable custom fields)
      if (
        globalSearch &&
        !task.title?.toLowerCase().includes(globalSearch.toLowerCase()) &&
        !task.description?.toLowerCase().includes(globalSearch.toLowerCase()) &&
        !matchesSearchableCustomFields(task, customFields, globalSearch)
      ) {
        return false;
      }

      // Column filters
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "title") {
          if (!task.title?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "status") {
          if (!(val as string[]).includes(task.status)) return false;
        } else if (colId === "priority") {
          if (!(val as string[]).includes(task.priority)) return false;
        } else if (colId === "assignee") {
          const assigneeName = task.assignee?.full_name || task.assignee?.email || "Unassigned";
          if (!assigneeName.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "linked_to") {
          const linkedText = `${task.contact?.name || ''} ${task.deal?.title || ''}`;
          if (!linkedText.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "due_date") {
          if (!isDateInFilter(task.due_date, val as string | string[])) return false;
        } else if (colId.startsWith("cf_")) {
          const cfVal = task[colId];
          const typeOfCf = customFields.find(f => `cf_${f.id}` === colId)?.field_type;
          
          if (typeOfCf === 'date') {
            if (!isDateInFilter(cfVal, val as string | string[])) return false;
          } else if (typeOfCf === 'dropdown' || typeOfCf === 'radio' || typeOfCf === 'multi-select') {
             if (!(val as string[]).includes(cfVal)) return false;
          } else {
             if (!cfVal?.toLowerCase().includes((val as string).toLowerCase())) return false;
          }
        }
      }
      return true;
    });
  }, [tasks, filterState, globalSearch, hideCompleted, customFields]);

  return (
    <PageLayout>
      <PageHeader
        title="Tasks"
        subtitle="Manage your tasks and to-dos."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
              <Upload className="size-4 mr-2" /> Import
            </Button>
            <Button onClick={() => router.push('/tasks/new')} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="size-4 mr-2" /> New Task
            </Button>
          </>
        }
      />

      <PageToolbar
        search={{
          value: globalSearch,
          onChange: setGlobalSearch,
          placeholder: "Search tasks...",
        }}
        actions={
          <label className="flex items-center gap-2 text-sm text-foreground bg-background border border-border px-3 rounded-md cursor-pointer hover:bg-muted h-9 w-fit">
            <Checkbox 
              checked={hideCompleted} 
              onCheckedChange={(checked) => setHideCompleted(checked === true)} 
            />
            Hide Completed
          </label>
        }
      />

      <BulkActionBar
        selectedCount={selectedTaskIds.size}
        onClear={() => setSelectedTaskIds(new Set())}
        actions={[
          {
            label: "Delete",
            icon: <Trash2 className="size-4" />,
            variant: "destructive",
            onClick: handleBulkDelete,
            disabled: bulkActionLoading,
          },
        ]}
        extraActions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" className="h-8 bg-background hover:bg-muted text-foreground" disabled={bulkActionLoading} />}
            >
              Change Status
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Object.keys(STATUS_COLORS).map(s => (
                <DropdownMenuItem key={s} onClick={() => handleBulkStatusChange(s)}>
                  Mark as {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <DataTable
        columns={visibleColumns}
        data={filteredTasks}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_tasks_table_columns"
        isLoading={loading}
        rowKey={(task) => task.id}
        onRowClick={(task) => router.push(`/tasks/${task.id}`)}
        selection={{
          selectedIds: selectedTaskIds,
          onSelectAll: (checked) => setSelectedTaskIds(checked ? new Set(filteredTasks.map(t => t.id)) : new Set()),
          onSelect: (id, checked) => setSelectedTaskIds(prev => {
             const next = new Set(prev);
             if (checked) next.add(id); else next.delete(id);
             return next;
          })
        }}
      />

      <TaskForm open={formOpen} onOpenChange={setFormOpen} task={editTask} onSaved={fetchTasks} />
      {importOpen && <ImportTasksModal open={importOpen} onOpenChange={setImportOpen} onImported={fetchTasks} />}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="size-5" /> Delete Task
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.title}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} className="border-border">Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

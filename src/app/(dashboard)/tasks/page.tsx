'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
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
  Eye,
  EyeOff,
} from 'lucide-react';
import { TaskForm } from '@/components/tasks/task-form';
import { ImportWizard } from '@/components/import/import-wizard';
import { Checkbox } from '@/components/ui/checkbox';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table/data-table';
import { RowActions } from '@/components/ui/data-table/row-actions';
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
  const [showInactive, setShowInactive] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);

    let tasksBase = supabase.from('tasks').select('*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), contact:contacts!tasks_contact_id_fkey(name, phone), deal:deals!tasks_deal_id_fkey(title)').order('created_at', { ascending: false });
    if (!showInactive) tasksBase = tasksBase.eq('is_active', true);
    const [{ data: tasksData }, { data: fieldsData }] = await Promise.all([
      tasksBase,
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
  }, [supabase, showInactive]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);
  useRealtimeRefresh('tasks', fetchTasks);

  useEffect(() => {
    if (searchParams.get("new") === "true") {
      router.push('/tasks/new');
    }
  }, [searchParams, router]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase.from('tasks').update({ is_active: false }).eq('id', deleteTarget.id);

    if (error) toast.error('Failed to deactivate task');
    else { toast.success('Task moved to Inactive'); fetchTasks(); }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleReactivate(task: Task) {
    const { error } = await supabase.from('tasks').update({ is_active: true }).eq('id', task.id);
    if (error) toast.error('Failed to re-activate task');
    else { toast.success('Task re-activated'); fetchTasks(); }
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
    const { error } = await supabase.from('tasks').update({ is_active: false }).in('id', ids);
    if (!error) {
      toast.success(`${ids.length} task(s) moved to Inactive`);
      fetchTasks();
    } else {
      toast.error('Failed to update tasks');
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
            title={task.status === 'Completed' ? 'Mark as pending' : 'Mark as completed'}
            className={`size-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${task.status === 'Completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-muted-foreground/60 text-muted-foreground/40 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10'}`}
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
      id: "record_status",
      label: "Record Status",
      type: "select",
      visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (task) => {
        const active = (task as any).is_active !== false;
        return (
          <Badge className={active
            ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
            : 'bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold'}>
            {active ? 'Active' : 'Inactive'}
          </Badge>
        );
      }
    },
    {
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      render: (task) => {
        const inactive = (task as any).is_active === false;
        return (
          <RowActions
            isInactive={inactive}
            onEdit={() => { setEditTask(task); setFormOpen(true); }}
            onDelete={() => { setDeleteTarget(task); setDeleteConfirmOpen(true); }}
            onReactivate={() => handleReactivate(task)}
            deleteTitle="Move to Inactive"
          />
        );
      }
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
        } else if (colId === "record_status") {
          const want = val as string[];
          if (Array.isArray(want) && want.length) {
            const state = (task as any).is_active !== false ? "active" : "inactive";
            if (!want.includes(state)) return false;
          }
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
            label: "Move to Inactive",
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
        menuActions={
          <DropdownMenuItem onClick={() => setShowInactive((v) => !v)} className="cursor-pointer gap-2">
            {showInactive ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </DropdownMenuItem>
        }
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
      {importOpen && <ImportWizard open={importOpen} onOpenChange={setImportOpen} module="tasks" onImported={fetchTasks} />}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="size-5" /> Move Task to Inactive
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Move <span className="font-medium text-foreground">{deleteTarget?.title}</span> to Inactive?
              It will be hidden from the default list but you can re-activate it anytime via “Show Inactive”.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} className="border-border">Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Move to Inactive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

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
  RotateCcw,
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
import {
  inactiveSelection,
  reactivateDisabledReason,
  bulkReactivate,
  reactivatedMessage,
} from '@/lib/table/bulk-activation';

import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters } from '@/lib/table/apply-filters';
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
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';

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

/** Stored tasks fields with no hand-written column, shown via Manage Column. */
const TASK_EXTRA_COLUMNS: readonly ExtraColumnSpec<any>[] = [
      ['description', 'Description', 'text'],
      ['activity_type', 'Activity Type', 'text'],
      ['start_date', 'Start Date', 'date'],
      ['due_time', 'Due Time', 'text'],
      ['reminder_date', 'Reminder Date', 'date'],
      ['reminder_time', 'Reminder Time', 'text'],
      ['created_at', 'Created', 'date'],
];

export default function TasksPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEditSettings = useCan('edit-settings');

  
  // DataTable state
  const [hideCompleted, setHideCompleted] = useState(true);
  // Default filter shows Active tasks (Inactive/all via the Status column filter).
  const tableView = useTableView("wacrm_tasks_table_columns", { record_status: ['active'] });
  const { filterState } = tableView;
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

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('module_name', 'task');
      if (alive) setCustomFields(data || []);
    })();
    return () => { alive = false; };
  }, [supabase]);

  /**
   * One page of tasks, searched and filtered by the database.
   * assignee_name, linked_text, search_text and custom_values are columns on
   * the row (migrations 20261012120000 / 20261012130000), so the two name
   * filters hit real columns and the embeds are only for display.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('tasks')
        .select(
          '*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), contact:contacts!tasks_contact_id_fkey(name, phone), deal:deals!tasks_deal_id_fkey(title)',
          { count: 'exact' },
        );

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyTextFilter(q, 'title', filters.title);
      q = applyInFilter(q, 'status', filters.status);
      q = applyInFilter(q, 'priority', filters.priority);
      q = applyInFilter(q, 'assignee_name', filters.assignee);
      q = applyTextFilter(q, 'linked_text', filters.linked_to);
      q = applyDateFilter(q, 'due_date', filters.due_date);
      q = applyCustomFieldFilters(q, filters, customFields);

      const want = filters.record_status as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) q = q.eq('is_active', want[0] === 'active');

      // "Hide completed" is a toolbar toggle, not a column filter.
      if (hideCompleted) q = q.not('status', 'in', '("Completed","Cancelled")');

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, TASK_EXTRA_COLUMNS);


      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [customFields, hideCompleted],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    deps: [cfKey, hideCompleted],
  });

  const fetchTasks = table.reload;
  const loading = table.loading;

  const tasks = useMemo(
    () => table.rows.map((row) => {
      const t = row as Record<string, any>;
      return { ...t, ...(t.custom_values ?? {}) };
    }),
    [table.rows],
  );

  const pageIds = useMemo(() => tasks.map((t) => t.id).join(','), [tasks]);
  useEffect(() => { setSelectedTaskIds(new Set()); }, [pageIds]);

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => {
        const t = r as Record<string, any>;
        return { ...t, ...(t.custom_values ?? {}) };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

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

  /**
   * Restore every selected task that is currently Inactive. Not confirmed:
   * re-activating is not destructive, and the button is disabled unless the
   * selection holds something Inactive.
   */
  async function handleBulkReactivate() {
    const ids = inactiveSelection(tasks, selectedTaskIds);
    if (ids.length === 0) return;
    setBulkActionLoading(true);
    const { error } = await bulkReactivate(supabase, 'tasks', ids);
    if (error) toast.error('Failed to re-activate tasks');
    else {
      toast.success(reactivatedMessage(ids.length, 'task'));
      setSelectedTaskIds(new Set());
      fetchTasks();
    }
    setBulkActionLoading(false);
  }

  const inactiveSelectedIds = inactiveSelection(tasks, selectedTaskIds);

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
      // Strong, unmistakable colours so High/Urgent stand out at a glance.
      render: (task) => (
        <Badge className={`${PRIORITY_COLORS[task.priority] || 'bg-slate-600 text-white shadow-sm border-transparent'} font-semibold`}>
          {task.priority}
        </Badge>
      )
    },
    {
      id: "assignee",
      label: "Assigned To",
      type: "select",
      valueSource: { kind: "distinct", module: "task", column: "assignee_name" },
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
    },
    // The rest of what a task stores, so Manage Column can offer it.
    ...extraColumns<any>(TASK_EXTRA_COLUMNS),
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, tasks);
  }, [columns, customFields, tasks]);

  /** buildQuery already applied the search, every filter and Hide Completed. */
  const filteredTasks = tasks;

  return (
    <PageLayout fill>
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
          value: table.search,
          onChange: table.setSearch,
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
            label: "Re-activate",
            icon: <RotateCcw className="size-4" />,
            variant: "outline",
            onClick: handleBulkReactivate,
            disabled: bulkActionLoading || inactiveSelectedIds.length === 0,
            title: reactivateDisabledReason(selectedTaskIds.size, inactiveSelectedIds.length),
          },
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
        fill
        columns={visibleColumns}
        data={filteredTasks}
        tableView={tableView}
        isLoading={loading}
        rowKey={(task) => task.id}
        onRowClick={(task) => router.push(`/tasks/${task.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
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

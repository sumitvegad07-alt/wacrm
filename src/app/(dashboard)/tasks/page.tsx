'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Task } from '@/types';

function isOverdue(task: Task) {
  if (task.status === 'Completed' || task.status === 'Cancelled') return false;
  if (!task.due_date) return false;
  
  const now = new Date();
  // If no time is provided, assume end of day
  const timeStr = task.due_time || '23:59:59';
  const dueDate = new Date(`${task.due_date}T${timeStr}`);
  
  return dueDate < now;
}
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  X,
  Upload,
  Filter,
} from 'lucide-react';
import { TaskForm } from '@/components/tasks/task-form';
import { ImportTasksModal } from '@/components/tasks/import-tasks-modal';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

const PAGE_SIZE = 25;

const PRIORITY_COLORS: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-700 border-slate-200',
  Medium: 'bg-blue-100 text-blue-700 border-blue-200',
  High: 'bg-orange-100 text-orange-700 border-orange-200',
  Urgent: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-200',
  'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
  Waiting: 'bg-amber-100 text-amber-700 border-amber-200',
  Completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-red-100 text-red-700 border-red-200',
};

export default function TasksPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [hideCompleted, setHideCompleted] = useState(true);

  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('tasks')
      .select('*, assignee:profiles!tasks_assigned_user_id_fkey(full_name, email), contact:contacts!tasks_contact_id_fkey(name, phone), deal:deals!tasks_deal_id_fkey(title)', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`title.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
    }

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    } else if (hideCompleted) {
      query = query.neq('status', 'Completed').neq('status', 'Cancelled');
    }

    if (priorityFilter) {
      query = query.eq('priority', priorityFilter);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load tasks');
    } else {
      setTasks(data as any || []);
      setTotalCount(count || 0);
      setSelectedTaskIds(new Set());
    }
    setLoading(false);
  }, [supabase, page, search, statusFilter, priorityFilter, hideCompleted]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (searchParams.get("new") === "true" && !loading && !formOpen) {
      openAddForm();
      router.replace('/tasks');
    }
  }, [searchParams, loading, formOpen, router]);

  function openAddForm() {
    setEditTask(null);
    setFormOpen(true);
  }

  function openEditForm(task: Task) {
    setEditTask(task);
    setFormOpen(true);
  }

  function confirmDelete(task: Task) {
    setDeleteTarget(task);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete task');
    } else {
      toast.success('Task deleted');
      fetchTasks();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleQuickComplete(task: Task, e: React.MouseEvent) {
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

  function toggleTaskSelection(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const newSet = new Set(selectedTaskIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedTaskIds(newSet);
  }

  function toggleAllSelection() {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map(t => t.id)));
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

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground">Manage your tasks and to-dos.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2 border-border text-foreground hover:bg-muted">
            <Upload className="size-4" />
            Import
          </Button>
          <Button onClick={() => { setEditTask(null); setFormOpen(true); }} className="gap-2">
            <Plus className="size-4" />
            New Task
          </Button>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-2 px-6">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search tasks..."
            className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="border-border text-muted-foreground hover:bg-muted shrink-0"
              />
            }
          >
            <Filter className="size-4 mr-2" />
            Filter
            {(statusFilter || priorityFilter) && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {(statusFilter ? 1 : 0) + (priorityFilter ? 1 : 0)}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Status</h4>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(0);
                  }}
                  className="h-9 w-full rounded-md border border-border bg-muted px-2.5 text-sm outline-none"
                >
                  <option value="">All Statuses</option>
                  {Object.keys(STATUS_COLORS).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Priority</h4>
                <select
                  value={priorityFilter}
                  onChange={(e) => {
                    setPriorityFilter(e.target.value);
                    setPage(0);
                  }}
                  className="h-9 w-full rounded-md border border-border bg-muted px-2.5 text-sm outline-none"
                >
                  <option value="">All Priorities</option>
                  {Object.keys(PRIORITY_COLORS).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              {(statusFilter || priorityFilter) && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full mt-2" 
                  onClick={() => {
                    setStatusFilter('');
                    setPriorityFilter('');
                    setHideCompleted(true);
                    setPage(0);
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <label className="flex items-center gap-2 text-sm text-muted-foreground ml-auto bg-card border border-border px-3 py-1.5 rounded-md cursor-pointer hover:bg-muted shrink-0">
          <Checkbox 
            checked={hideCompleted} 
            onCheckedChange={(checked) => {
              setHideCompleted(checked === true);
              setPage(0);
            }} 
          />
          Hide Completed
        </label>
      </div>

      {selectedTaskIds.size > 0 && (
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-md p-2 px-4 mx-6 shadow-sm animate-in fade-in slide-in-from-top-2">
          <span className="text-sm font-medium text-primary">
            {selectedTaskIds.size} task{selectedTaskIds.size > 1 ? 's' : ''} selected
          </span>
          <div className="h-4 w-px bg-primary/20 mx-2" />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="bg-background hover:bg-muted text-foreground" disabled={bulkActionLoading} />}>
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
          <Button variant="destructive" size="sm" disabled={bulkActionLoading} onClick={handleBulkDelete}>
            <Trash2 className="size-3.5 mr-2" />
            Delete Selected
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden mx-6">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-12 text-center">
                <Checkbox 
                  checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                  onCheckedChange={toggleAllSelection}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">Title</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground">Priority</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">Assigned To</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">Scheduled Date</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">Linked To</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Loading tasks...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <CheckSquare className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No tasks found.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openAddForm}
                      className="mt-2 border-border text-muted-foreground hover:bg-muted"
                    >
                      <Plus className="size-3.5 mr-2" />
                      Create a task
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow
                  key={task.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => router.push(`/tasks/${task.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Checkbox 
                        checked={selectedTaskIds.has(task.id)}
                        onCheckedChange={() => toggleTaskSelection(task.id, { stopPropagation: () => {} } as any)}
                      />
                      <button 
                        onClick={(e) => handleQuickComplete(task, e)}
                        className={`size-5 rounded-full border flex items-center justify-center ${task.status === 'Completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-muted-foreground/30 text-transparent hover:border-emerald-500 hover:text-emerald-500/20'}`}
                      >
                        <CheckSquare className="size-3.5" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className={`text-foreground font-medium ${task.status === 'Completed' ? 'line-through opacity-50' : ''}`}>
                    {task.title}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`font-normal ${STATUS_COLORS[task.status] || ''}`}>
                        {task.status}
                      </Badge>
                      {isOverdue(task) && (
                        <Badge variant="destructive" className="font-normal text-[10px] px-1.5 py-0">
                          Overdue
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-normal ${PRIORITY_COLORS[task.priority] || ''}`}>
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {task.assignee?.full_name || task.assignee?.email || <span className="text-muted-foreground italic">Unassigned</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
                    {task.due_time ? ` at ${task.due_time.substring(0, 5)}` : ''}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
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
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(task);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(task);
                          }}
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
            {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        task={editTask}
        onSaved={fetchTasks}
      />

      <ImportTasksModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchTasks}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.title}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

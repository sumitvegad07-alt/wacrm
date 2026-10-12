"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Plus, Search, Filter, CheckCircle, XCircle, FileText, Download, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useAuth } from "@/hooks/use-auth";
import { useDataScope } from "@/hooks/use-data-scope";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge, ConfirmDialog } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTableView } from "@/hooks/use-table-view";
import { useServerTable } from "@/hooks/use-server-table";
import { fetchAllPages } from "@/lib/table/export-all-pages";
import type { ServerTableQuery } from "@/lib/table/server-query";
import { applyCustomFieldFilters, applyDateFilter, applyInFilter, applyTextFilter } from "@/lib/table/apply-filters";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { isDateInFilter } from "@/lib/date-filters";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { getVisibleTableColumns, matchesSearchableCustomFields } from "@/lib/custom-fields";
import { Expense, CustomField } from "@/types";

export default function ExpensesPage() {
  const { accountId, profile, accountRole, user } = useAuth();
  const scope = useDataScope();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [deleteTargetExp, setDeleteTargetExp] = useState<string | null>(null);
  const [deletingExp, setDeletingExp] = useState(false);
  
  // Default filter shows Active expenses (Inactive/all via the Status column filter).
  const tableView = useTableView("wacrm_expenses_table_columns", { record_status: ['active'] });
  const { filterState } = tableView;

  const isAdmin = accountRole === 'admin' || accountRole === 'owner';

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("custom_fields").select("*")
        .eq("account_id", accountId).eq("module_name", "expense");
      if (alive) setCustomFields((data as CustomField[]) || []);
    })();
    return () => { alive = false; };
  }, [accountId, supabase]);

  /**
   * One page of expenses, searched and filtered by the database.
   * employee_name, expense_type_name, search_text and custom_values are columns
   * on the row (migrations 20261012110000 / 20261012130000). The embeds remain
   * only because the table renders other fields off them.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      // Directional data-scoping on employee_id (a profiles.id). RLS remains
      // the real boundary - see useDataScope.
      let q = scope.apply(
        sb
          .from("expenses")
          .select("*, expense_type:expense_types(*), employee:profiles!expenses_employee_id_fkey(*)", { count: "exact" })
          .eq("account_id", accountId!),
        "employee_id",
        "profile",
      );

      if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);

      q = applyDateFilter(q, "expense_date", filters.expense_date);
      q = applyTextFilter(q, "employee_name", filters.employee);
      q = applyInFilter(q, "expense_type_name", filters.expense_type);
      q = applyInFilter(q, "status", filters.status);
      q = applyCustomFieldFilters(q, filters, customFields);

      const want = filters.record_status as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) q = q.eq("is_active", want[0] === "active");

      return q.order("created_at", { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [accountId, scope, customFields],
  );

  /** Bulk approve/reject spinner. Was the list's own loading flag before the
   *  list started paging on the server. */
  const [busy, setBusy] = useState(false);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: Boolean(accountId) && scope.ready,
    deps: [accountId, scope.key, customFields],
  });

  const loadExpenses = table.reload;
  const loading = table.loading || busy;

  const expenses = useMemo(
    () => table.rows.map((row) => {
      const e = row as Record<string, any>;
      return { ...e, ...(e.custom_values ?? {}) };
    }),
    [table.rows],
  );

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => {
        const e = r as Record<string, any>;
        return { ...e, ...(e.custom_values ?? {}) };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, profile, scope.ready, scope.key]);
  useRealtimeRefresh('expenses', loadExpenses);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/expenses/new');
    }
  }, [searchParams, router]);

  const handleStatusUpdate = async (id: string, newStatus: string, reason?: string) => {
    if (!isAdmin) return;
    
    let approved_amount = null;
    let approved_by = user?.id;
    let approved_at = new Date().toISOString();
    
    if (newStatus === "Approved") {
      const expense = expenses.find(e => e.id === id);
      approved_amount = expense?.amount;
    }
    
    const updatePayload: any = { 
      status: newStatus,
      rejection_reason: reason || null,
      approved_by,
      approved_at
    };
    if (newStatus === "Approved") {
      updatePayload.approved_amount = approved_amount;
    }
    
    const { error } = await supabase
      .from("expenses")
      .update(updatePayload)
      .eq("id", id)
      .eq("account_id", accountId);
      
    if (error) {
      console.error("Expense status update error:", error);
      toast.error(`Failed to update status: ${error.message}`);
    } else {
      toast.success(`Expense ${newStatus}`);
      loadExpenses();
    }
  };

  const doDelete = async () => {
    if (!deleteTargetExp) return;
    setDeletingExp(true);
    const { error } = await supabase.from("expenses").update({ is_active: false }).eq("id", deleteTargetExp);
    setDeletingExp(false);
    if (error) {
      toast.error("Failed to deactivate expense");
    } else {
      toast.success("Expense moved to Inactive");
      loadExpenses();
    }
    setDeleteTargetExp(null);
  };

  const handleReactivate = async (id: string) => {
    const { error } = await supabase.from("expenses").update({ is_active: true }).eq("id", id);
    if (error) toast.error("Failed to re-activate expense");
    else { toast.success("Expense re-activated"); loadExpenses(); }
  };

  const handleBulkApprove = async () => {
    if (!isAdmin) return;
    
    // Filter selected ids to only those that are pending
    const pendingIds = Array.from(selectedExpenseIds).filter(id => {
      const expense = expenses.find(e => e.id === id);
      return expense?.status === "Pending";
    });

    if (pendingIds.length === 0) {
      toast.info("No pending expenses selected.");
      return;
    }

    if (!confirm(`Are you sure you want to approve ${pendingIds.length} expense(s)?`)) return;

    setBusy(true);
    let successCount = 0;
    
    for (const id of pendingIds) {
      const expense = expenses.find(e => e.id === id);
      if (!expense) continue;
      
      const { error } = await supabase
        .from("expenses")
        .update({ 
          status: "Approved",
          approved_amount: expense.amount,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq("id", id);
        
      if (!error) successCount++;
    }

    if (successCount > 0) {
      toast.success(`Successfully approved ${successCount} expense(s)`);
      setSelectedExpenseIds(new Set());
      loadExpenses();
    } else {
      toast.error("Failed to approve expenses");
      setBusy(false);
    }
  };

  const handleBulkReject = async () => {
    if (!isAdmin) return;
    const pendingIds = Array.from(selectedExpenseIds).filter(id => {
      const expense = expenses.find(e => e.id === id);
      return expense?.status === "Pending";
    });

    if (pendingIds.length === 0) {
      toast.info("No pending expenses selected.");
      return;
    }

    const reason = prompt(`Enter rejection reason for ${pendingIds.length} expense(s):`);
    if (reason === null) return;

    setBusy(true);
    let successCount = 0;
    
    for (const id of pendingIds) {
      const { error } = await supabase
        .from("expenses")
        .update({ 
          status: "Rejected",
          rejection_reason: reason,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq("id", id);
        
      if (!error) successCount++;
    }

    if (successCount > 0) {
      toast.success(`Successfully rejected ${successCount} expense(s)`);
      setSelectedExpenseIds(new Set());
      loadExpenses();
    } else {
      toast.error("Failed to reject expenses");
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!isAdmin) return;
    const pendingIds = Array.from(selectedExpenseIds).filter(id => {
      const expense = expenses.find(e => e.id === id);
      return expense?.status === "Pending";
    });

    if (pendingIds.length === 0) {
      toast.info("No pending expenses selected. You can only delete pending expenses.");
      return;
    }

    if (!confirm(`Move ${pendingIds.length} pending expense(s) to Inactive? They can be re-activated later.`)) return;

    setBusy(true);
    let successCount = 0;
    
    for (const id of pendingIds) {
      const { error } = await supabase.from("expenses").update({ is_active: false }).eq("id", id);
      if (!error) successCount++;
    }

    if (successCount > 0) {
      toast.success(`${successCount} expense(s) moved to Inactive`);
      setSelectedExpenseIds(new Set());
      loadExpenses();
    } else {
      toast.error("Failed to update expenses");
      setBusy(false);
    }
  };

  const columns: ColumnDef<Expense>[] = [
    {
      id: "expense_date",
      label: "Date",
      type: "date",
      render: (expense) => <span>{format(new Date(expense.expense_date), "dd MMM, yyyy")}</span>
    },
    {
      id: "employee",
      label: "Employee",
      type: "text",
      render: (expense) => <span>{expense.employee?.full_name || "-"}</span>
    },
    {
      id: "expense_type",
      label: "Type",
      type: "select",
      options: Array.from(new Set(expenses.map(e => e.expense_type?.expense_name))).filter(Boolean).map(t => ({label: t as string, value: t as string})),
      render: (expense) => (
        <div>
          <p className="font-medium">{expense.expense_number || "-"} - {expense.expense_type?.expense_name}</p>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded uppercase tracking-wider">
            {expense.expense_type?.allowance_type}
          </span>
        </div>
      )
    },
    {
      id: "amount",
      label: "Amount",
      type: "text",
      render: (expense) => (
        <span className="font-semibold text-foreground">₹{expense.amount}</span>
      )
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: [
        { label: "Pending", value: "Pending" },
        { label: "Approved", value: "Approved" },
        { label: "Rejected", value: "Rejected" }
      ],
      render: (expense) => (
        <StatusBadge status={expense.status.toLowerCase()} label={expense.status} />
      )
    },
    {
      id: "proof_file",
      label: "Proof",
      type: "text",
      render: (expense) => (
        expense.proof_file ? (
          <a href={expense.proof_file} target="_blank" rel="noreferrer" className="text-primary flex items-center gap-1 text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
            <FileText className="h-4 w-4" /> View
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">No file</span>
        )
      )
    },
    {
      id: "record_status",
      label: "Record Status",
      type: "select",
      visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (expense) => {
        const active = (expense as any).is_active !== false;
        return (
          <Badge className={active
            ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
            : 'bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold'}>
            {active ? 'Active' : 'Inactive'}
          </Badge>
        );
      }
    }
  ];

  if (isAdmin) {
    columns.push({
      id: "actions",
      label: "Action",
      type: "text",
      render: (expense) => {
        const inactive = (expense as any).is_active === false;
        return (
          <RowActions
            onEdit={() => { setSelectedExpense(expense); setFormOpen(true); }}
            onDelete={!inactive && expense.status === "Pending" ? () => setDeleteTargetExp(expense.id) : undefined}
            onReactivate={inactive ? () => handleReactivate(expense.id) : undefined}
            isInactive={inactive}
            deleteTitle="Move to Inactive"
          />
        );
      }
    });
  }

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, expenses);
  }, [columns, customFields, expenses]);

  /** buildQuery already applied the search and every filter. */
  const filteredExpenses = expenses;

  const handleRowClick = (expense: Expense) => {
    router.push(`/expenses/${expense.id}`);
  };

  return (
    <PageLayout>
      <PageToolbar
        filters={
          <div className="flex items-center gap-1">
            {["All", "Pending", "Approved", "Rejected"].map((status) => {
              const active = status === "All"
                ? !filterState["status"] || (Array.isArray(filterState["status"]) && filterState["status"].length === 0)
                : Array.isArray(filterState["status"]) && filterState["status"].includes(status);
              return (
                <Button
                  key={status}
                  size="sm"
                  variant={active ? "default" : "ghost"}
                  className="h-7 px-3 text-xs font-medium"
                  onClick={() => {
                    if (status === "All") {
                      tableView.setFilter("status", []);
                    } else {
                      tableView.setFilter("status", [status]);
                    }
                  }}
                >
                  {status}
                </Button>
              );
            })}
          </div>
        }
      />

      {isAdmin && (
        <BulkActionBar
          selectedCount={selectedExpenseIds.size}
          onClear={() => setSelectedExpenseIds(new Set())}
          actions={[
            {
              label: "Approve Selected",
              icon: <CheckCircle className="size-3.5" />,
              onClick: handleBulkApprove,
            },
            {
              label: "Reject Selected",
              icon: <XCircle className="size-3.5" />,
              variant: "outline",
              onClick: handleBulkReject,
            },
            {
              label: "Delete Selected",
              icon: <XCircle className="size-3.5" />,
              variant: "destructive",
              onClick: handleBulkDelete,
            },
          ]}
        />
      )}

      <DataTable
        columns={visibleColumns}
        data={filteredExpenses}
        actions={
          <Button size="sm" className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => router.push('/expenses/new')}>
            <Plus className="size-3 mr-1" /> New Expense
          </Button>
        }
        tableView={tableView}
        isLoading={loading}
        serverPagination={{ ...table.serverPagination, exportAll }}
        rowKey={(expense) => expense.id}
        onRowClick={handleRowClick}
        selection={{
          selectedIds: selectedExpenseIds,
          onSelect: (id, selected) => {
            const next = new Set(selectedExpenseIds);
            if (selected) next.add(id);
            else next.delete(id);
            setSelectedExpenseIds(next);
          },
          onSelectAll: (selected) => {
            if (selected) {
              setSelectedExpenseIds(new Set(filteredExpenses.map(e => e.id)));
            } else {
              setSelectedExpenseIds(new Set());
            }
          }
        }}
      />

      <ExpenseForm
        open={formOpen}
        onOpenChange={setFormOpen}
        expense={selectedExpense}
        onSaved={loadExpenses}
      />

      <ConfirmDialog
        open={!!deleteTargetExp}
        onOpenChange={(o) => { if (!o) setDeleteTargetExp(null); }}
        title="Move expense to Inactive"
        description="Move this expense to Inactive? It will be hidden from the default list but you can re-activate it anytime."
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deletingExp}
        onConfirm={doDelete}
      />
    </PageLayout>
  );
}

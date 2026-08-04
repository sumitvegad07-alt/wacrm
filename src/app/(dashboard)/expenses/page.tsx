"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Plus, Search, Filter, CheckCircle, XCircle, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { isDateInFilter } from "@/lib/date-filters";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { getVisibleTableColumns, matchesSearchableCustomFields } from "@/lib/custom-fields";
import { Expense, CustomField } from "@/types";

export default function ExpensesPage() {
  const { accountId, profile, accountRole, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  
  const [filterState, setFilterState] = useState<FilterState>({});

  const isAdmin = accountRole === 'admin' || accountRole === 'owner';

  async function loadExpenses() {
    if (!accountId) return;
    setLoading(true);
    
    const query = supabase
      .from("expenses")
      .select("*, expense_type:expense_types(*), employee:profiles!expenses_employee_id_fkey(*)")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
      
    // Non-admins only see their own expenses
    if (!isAdmin) {
      query.eq("employee_id", profile?.id);
    }

    const { data, error } = await query;
    
    // Fetch custom fields
    const { data: fieldsData } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("account_id", accountId)
      .eq("module_name", "expense");

    let enhancedExpenses = data || [];
    if (data && data.length > 0) {
      const ids = data.map((e: any) => e.id);
      const { data: valuesData } = await supabase
        .from("expense_custom_values")
        .select("*")
        .in("expense_id", ids);
        
      if (valuesData && valuesData.length > 0) {
        enhancedExpenses = data.map((exp: any) => {
          const expValues = valuesData.filter((v: any) => v.expense_id === exp.id);
          const customData: any = {};
          expValues.forEach((v: any) => {
            customData[`cf_${v.custom_field_id}`] = v.value;
          });
          return { ...exp, ...customData };
        });
      }
    }

    if (error) {
      toast.error("Failed to load expenses");
    } else {
      setExpenses(enhancedExpenses as any);
      setCustomFields((fieldsData as CustomField[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadExpenses();
  }, [accountId, profile]);

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

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense? This action cannot be undone.")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete expense");
    } else {
      toast.success("Expense deleted successfully");
      loadExpenses();
    }
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

    setLoading(true);
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
      setLoading(false);
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

    setLoading(true);
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
      setLoading(false);
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

    if (!confirm(`Are you sure you want to permanently delete ${pendingIds.length} pending expense(s)?`)) return;

    setLoading(true);
    let successCount = 0;
    
    for (const id of pendingIds) {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (!error) successCount++;
    }

    if (successCount > 0) {
      toast.success(`Successfully deleted ${successCount} expense(s)`);
      setSelectedExpenseIds(new Set());
      loadExpenses();
    } else {
      toast.error("Failed to delete expenses");
      setLoading(false);
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
    }
  ];

  if (isAdmin) {
    columns.push({
      id: "actions",
      label: "Actions",
      type: "text",
      render: (expense) => {
        return (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs font-medium"
              onClick={() => { setSelectedExpense(expense); setFormOpen(true); }}
            >
              Edit
            </Button>
            {expense.status === "Pending" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                onClick={() => handleDelete(expense.id)}
              >
                Delete
              </Button>
            )}
          </div>
        );
      }
    });
  }

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, expenses);
  }, [columns, customFields, expenses]);

  const handleFilterChange = (columnId: string, value: any) => {
    setFilterState(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      if (
        globalSearch &&
        !expense.employee?.full_name?.toLowerCase().includes(globalSearch.toLowerCase()) &&
        !expense.expense_type?.expense_name?.toLowerCase().includes(globalSearch.toLowerCase()) &&
        !matchesSearchableCustomFields(expense, customFields, globalSearch)
      ) {
        return false;
      }

      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "expense_date") {
          if (!isDateInFilter(expense.expense_date, val as string | string[])) return false;
        } else if (colId === "employee") {
          if (!expense.employee?.full_name?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "expense_type") {
          if (!(val as string[]).includes(expense.expense_type?.expense_name || "")) return false;
        } else if (colId === "status") {
          if (!(val as string[]).includes(expense.status)) return false;
        }
      }

      return true;
    });
  }, [expenses, filterState, globalSearch]);

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
                      handleFilterChange("status", []);
                    } else {
                      handleFilterChange("status", [status]);
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
        filterState={filterState}
        onFilterChange={handleFilterChange}
        storageKey="wacrm_expenses_table_columns"
        isLoading={loading}
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
    </PageLayout>
  );
}

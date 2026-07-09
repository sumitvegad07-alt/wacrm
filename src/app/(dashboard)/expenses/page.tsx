"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus, Search, Filter, CheckCircle, XCircle, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { isDateInFilter } from "@/lib/date-filters";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { Expense, CustomField } from "@/types";

export default function ExpensesPage() {
  const { accountId, profile, accountRole, user } = useAuth();
  const router = useRouter();
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

  const handleStatusUpdate = async (id: string, newStatus: string, reason?: string) => {
    if (!isAdmin) return;
    
    let approved_amount = null;
    let approved_by = profile?.id;
    let approved_at = new Date().toISOString();
    
    if (newStatus === "Approved") {
      const expense = expenses.find(e => e.id === id);
      approved_amount = expense?.amount; // simple auto-approve full amount
    }
    
    const { error } = await supabase
      .from("expenses")
      .update({ 
        status: newStatus,
        rejection_reason: reason || null,
        approved_amount,
        approved_by,
        approved_at
      })
      .eq("id", id);
      
    if (error) {
      toast.error("Failed to update status");
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
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          expense.status === "Approved" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
          expense.status === "Rejected" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        }`}>
          {expense.status}
        </span>
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
        if (expense.status === "Pending") {
          return (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" className="h-8 border-green-500/30 text-green-600 hover:bg-green-50" onClick={() => handleStatusUpdate(expense.id, "Approved")}>
                <CheckCircle className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-600 hover:bg-red-50" onClick={() => {
                const reason = prompt("Enter rejection reason:");
                if (reason !== null) handleStatusUpdate(expense.id, "Rejected", reason);
              }}>
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(expense.id)}>
                Delete
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="text-muted-foreground text-xs">{expense.status === "Approved" ? "Done" : "Rejected"}</span>
          </div>
        );
      }
    });
  }

  // Append custom fields to columns
  customFields.forEach(cf => {
    let type: any = "text";
    let options: any[] = [];
    
    if (cf.field_type === 'dropdown' || cf.field_type === 'radio' || cf.field_type === 'multi-select') {
      type = "select";
      const uniqueVals = Array.from(new Set(expenses.map(e => (e as any)[`cf_${cf.id}`]).filter(Boolean)));
      options = uniqueVals.map(val => ({ label: val, value: val }));
    } else if (cf.field_type === 'date') {
      type = "date";
    }

    columns.push({
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options.length > 0 ? options : undefined,
      render: (expense) => {
        const val = (expense as any)[`cf_${cf.id}`];
        if (cf.field_type === 'attachment' && val) {
          return <a href={val} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>View File</a>;
        }
        return <span>{val || "-"}</span>;
      }
    });
  });

  const handleFilterChange = (columnId: string, value: any) => {
    setFilterState(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      if (globalSearch && 
          !expense.employee?.full_name?.toLowerCase().includes(globalSearch.toLowerCase()) && 
          !expense.expense_type?.expense_name?.toLowerCase().includes(globalSearch.toLowerCase())) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Manage and approve employee expenses." : "Submit and track your expense claims."}
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => {
          setSelectedExpense(null);
          setFormOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> New Expense
        </Button>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search expenses..." 
            className="pl-9"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <Filter className="h-4 w-4" /> Filter
          </Button>
        </div>
      </div>

      {selectedExpenseIds.size > 0 && isAdmin && (
        <div className="bg-card border border-border p-4 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="px-3 py-1 bg-primary/10 text-primary border-primary/20">
              {selectedExpenseIds.size} selected
            </Badge>
            <span className="text-sm font-medium text-foreground">
              Bulk Actions
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedExpenseIds(new Set())}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-50" onClick={handleBulkDelete}>
              <XCircle className="mr-2 h-4 w-4" /> Delete Selected
            </Button>
            <Button size="sm" variant="outline" className="text-amber-600 border-amber-500/30 hover:bg-amber-50" onClick={handleBulkReject}>
              <XCircle className="mr-2 h-4 w-4" /> Reject Selected
            </Button>
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleBulkApprove}>
              <CheckCircle className="mr-2 h-4 w-4" /> Approve Selected
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredExpenses}
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
    </div>
  );
}

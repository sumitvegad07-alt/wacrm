"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, FileText, CheckCircle, XCircle, Info, Calendar, MapPin, Loader2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { Timeline } from "@/components/shared/timeline";
import { format } from "date-fns";

export default function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const supabase = createClient();
  const { accountId, profile, accountRole, user } = useAuth();
  const isAdmin = accountRole === 'admin' || accountRole === 'owner';

  const [expense, setExpense] = useState<any>(null);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [odometerSession, setOdometerSession] = useState<any>(null);
  
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const fetchAllData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    
    // 1. Fetch Expense
    const { data: expenseData, error: expenseError } = await supabase
      .from("expenses")
      .select("*, expense_type:expense_types(*), employee:profiles!expenses_employee_id_fkey(*)")
      .eq("id", resolvedParams.id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (expenseError || !expenseData) {
      toast.error("Expense not found or you do not have permission to view it.");
      router.push("/expenses");
      return;
    }
    
    // Non-admins can only view their own expenses
    if (!isAdmin && expenseData.employee_id !== profile?.id) {
      toast.error("Permission denied");
      router.push("/expenses");
      return;
    }

    setExpense(expenseData);

    // 2. Fetch everything else in parallel
    const [
      fieldsRes,
      valuesRes,
      tasksRes,
      activitiesRes
    ] = await Promise.all([
      supabase.from('custom_fields').select('*').eq("module_name", "expense").order('field_name'),
      supabase.from('expense_custom_values').select('*').eq('expense_id', resolvedParams.id),
      supabase.from('tasks').select('*').eq('expense_id', resolvedParams.id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'expense').eq('record_id', resolvedParams.id).order('created_at', { ascending: false })
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    
    if (tasksRes.data) {
      // Enrich tasks with assignee profiles
      const assigneeIds = Array.from(new Set(tasksRes.data.map(t => t.assigned_user_id).filter(Boolean)));
      if (assigneeIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select('id, full_name, email').in('id', assigneeIds);
        const pMap = (profilesData || []).reduce((acc: any, p: any) => { acc[p.id] = p; return acc; }, {});
        setTasks(tasksRes.data.map(t => ({ ...t, assignee: pMap[t.assigned_user_id] || null })));
      } else {
        setTasks(tasksRes.data);
      }
    }

    const activitiesData = activitiesRes.data;
    if (activitiesData && activitiesData.length > 0) {
      const userIds = Array.from(new Set(activitiesData.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        
        const enrichedActivities = activitiesData.map((a: any) => ({
          ...a,
          user: profileMap[a.user_id] || null
        }));
        setActivities(enrichedActivities);
      } else {
        setActivities(activitiesData);
      }
    } else {
      setActivities([]);
    }
    
    // 3. Fetch Odometer Session if it's a travelling expense
    if (expenseData.expense_type?.allowance_type === "TRAVELLING") {
      const dateStr = expenseData.expense_date;
      const { data: session } = await supabase
        .from('tracking_sessions')
        .select('*')
        .eq('user_id', expenseData.employee?.user_id)
        .gte('started_at', `${dateStr}T00:00:00Z`)
        .lt('started_at', `${dateStr}T23:59:59Z`)
        .not('odometer_in_photo_url', 'is', null)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      setOdometerSession(session);
    }

    setLoading(false);
  }, [resolvedParams.id, supabase, router, accountId, isAdmin, profile?.id]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleStatusUpdate = async (newStatus: string, reason?: string) => {
    if (!isAdmin || !expense) return;
    
    let approved_amount = null;
    let approved_by = user?.id;
    let approved_at = new Date().toISOString();
    
    if (newStatus === "Approved") {
      approved_amount = expense.amount; // simple auto-approve full amount
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
      .eq("id", expense.id);
      
    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success(`Expense ${newStatus}`);
      fetchAllData();
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this expense? This action cannot be undone.")) return;
    
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (error) {
      toast.error("Failed to delete expense");
    } else {
      toast.success("Expense deleted successfully");
      router.push("/expenses");
    }
  };

  if (loading) {
    return <div className="flex h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!expense) return null;

  const isPending = expense.status === "Pending";
  const statusColor = expense.status === "Approved" ? "bg-green-100 text-green-700 border-green-200" :
                      expense.status === "Rejected" ? "bg-red-100 text-red-700 border-red-200" :
                      "bg-amber-100 text-amber-700 border-amber-200";

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/expenses")} className="shrink-0 h-9 w-9 bg-card border border-border">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {expense.expense_number} - {expense.expense_type?.expense_name}
              </h1>
              <Badge variant="outline" className={statusColor}>
                {expense.status}
              </Badge>
              <span className="font-semibold text-lg text-foreground ml-2">₹{expense.amount}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
              Claimed by {expense.employee?.full_name || expense.employee?.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && isPending && (
            <>
              <Button size="sm" variant="outline" className="border-green-500/30 text-green-600 hover:bg-green-50" onClick={() => handleStatusUpdate("Approved")}>
                <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="border-red-500/30 text-red-600 hover:bg-red-50" onClick={() => {
                const reason = prompt("Enter rejection reason:");
                if (reason !== null) handleStatusUpdate("Rejected", reason);
              }}>
                <XCircle className="h-4 w-4 mr-1.5" /> Reject
              </Button>
            </>
          )}
          {(!isAdmin || expense.employee_id === profile?.id) && isPending && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              Edit Expense
            </Button>
          )}
          {isPending && (isAdmin || expense.employee_id === profile?.id) && (
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN - MAIN DETAILS */}
        <div className="lg:col-span-2 space-y-6">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Primary Info Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <Info className="h-4 w-4 text-primary" /> Expense Details
              </h3>
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Calendar className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase">Date</p>
                    <p className="text-sm font-medium">{format(new Date(expense.expense_date), "dd MMM, yyyy")}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <UserIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase">Employee</p>
                    <p className="text-sm font-medium">{expense.employee?.full_name || expense.employee?.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase">Allowance Type</p>
                    <p className="text-sm font-medium">{expense.expense_type?.allowance_type}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Amounts & Travel Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <MapPin className="h-4 w-4 text-primary" /> Amounts & Travel
              </h3>
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-green-500/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-green-600">₹</span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase">Claimed Amount</p>
                    <p className="text-lg font-bold text-foreground">₹{expense.amount}</p>
                  </div>
                </div>

                {expense.expense_type?.allowance_type === "TRAVELLING" && expense.travel_km > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-blue-600">KM</span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase">Distance Travelled</p>
                      <p className="text-sm font-medium">{expense.travel_km} KM</p>
                      {expense.rate_per_km && <p className="text-xs text-muted-foreground">@ ₹{expense.rate_per_km}/km</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Odometer Verification Card */}
            {odometerSession && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="font-semibold text-foreground flex items-center gap-2 border-b border-border pb-3">
                  <CheckCircle className="h-4 w-4 text-primary" /> Odometer Verification
                </h3>
                
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium uppercase text-center">Start Reading</p>
                    {odometerSession.odometer_in_photo_url ? (
                      <a href={odometerSession.odometer_in_photo_url} target="_blank" rel="noreferrer">
                        <img src={odometerSession.odometer_in_photo_url} alt="Start Odometer" className="w-full h-32 object-cover rounded-md border border-border" />
                      </a>
                    ) : (
                      <div className="w-full h-32 bg-muted/50 rounded-md border border-border flex items-center justify-center text-xs text-muted-foreground">No Photo</div>
                    )}
                    <p className="text-center font-bold">{odometerSession.odometer_in_reading ? `${odometerSession.odometer_in_reading} KM` : 'N/A'}</p>
                    <p className="text-center text-[10px] text-muted-foreground">{format(new Date(odometerSession.started_at), "hh:mm a")}</p>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium uppercase text-center">End Reading</p>
                    {odometerSession.odometer_out_photo_url ? (
                      <a href={odometerSession.odometer_out_photo_url} target="_blank" rel="noreferrer">
                        <img src={odometerSession.odometer_out_photo_url} alt="End Odometer" className="w-full h-32 object-cover rounded-md border border-border" />
                      </a>
                    ) : (
                      <div className="w-full h-32 bg-muted/50 rounded-md border border-border flex items-center justify-center text-xs text-muted-foreground">No Photo</div>
                    )}
                    <p className="text-center font-bold">{odometerSession.odometer_out_reading ? `${odometerSession.odometer_out_reading} KM` : 'N/A'}</p>
                    <p className="text-center text-[10px] text-muted-foreground">{format(new Date(odometerSession.ended_at), "hh:mm a")}</p>
                  </div>
                </div>
                
                {odometerSession.odometer_in_reading && odometerSession.odometer_out_reading && (
                  <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                    <span className="text-sm font-medium">Calculated Difference:</span>
                    <span className="font-bold">{(odometerSession.odometer_out_reading - odometerSession.odometer_in_reading).toFixed(1)} KM</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Remarks & Proof Card */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
             <h3 className="font-semibold text-foreground border-b border-border pb-3">Additional Information</h3>
             
             {expense.remarks && (
               <div>
                 <p className="text-xs text-muted-foreground font-medium uppercase mb-1">Remarks</p>
                 <p className="text-sm bg-muted/30 p-3 rounded-md">{expense.remarks}</p>
               </div>
             )}

             {expense.rejection_reason && (
               <div className="mt-4">
                 <p className="text-xs text-red-500 font-medium uppercase mb-1">Rejection Reason</p>
                 <p className="text-sm bg-red-500/10 text-red-700 p-3 rounded-md border border-red-500/20">{expense.rejection_reason}</p>
               </div>
             )}

             <div className="mt-4 pt-4 border-t border-border">
               <p className="text-xs text-muted-foreground font-medium uppercase mb-2">Proof Attachment</p>
               {expense.proof_file ? (
                 <a href={expense.proof_file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline bg-primary/5 px-3 py-2 rounded-md border border-primary/10">
                   <FileText className="h-4 w-4" />
                   View Attached Proof File
                 </a>
               ) : (
                 <p className="text-sm text-muted-foreground italic">No proof file attached.</p>
               )}
             </div>
          </div>

          {/* Custom Fields Card */}
          {customFields.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-foreground border-b border-border pb-3">Custom Fields</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 pt-1">
                {customFields.map(cf => (
                  <div key={cf.id}>
                    <p className="text-xs text-muted-foreground font-medium uppercase mb-1">{cf.field_name}</p>
                    <div className="text-sm">
                      {cf.field_type === 'attachment' && customValues[cf.id] ? (
                        <a href={customValues[cf.id]} target="_blank" rel="noreferrer" className="text-primary hover:underline">View File</a>
                      ) : (
                        <span className="font-medium">{customValues[cf.id] || '-'}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
        </div>

        {/* RIGHT COLUMN - TIMELINE */}
        <div className="lg:col-span-1">
          <Timeline 
            moduleName="expense" 
            recordId={expense.id} 
            tasks={tasks} 
            activities={activities} 
            onRefresh={fetchAllData} 
          />
        </div>
      </div>

      <ExpenseForm 
        open={editOpen} 
        onOpenChange={setEditOpen} 
        expense={expense} 
        onSaved={fetchAllData} 
      />
    </div>
  );
}

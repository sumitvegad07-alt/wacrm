"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, Contact, Deal, Product, Conversation, Profile, TaskStatus, TaskPriority, CustomField } from "@/types";
import { CustomFieldInput } from "@/components/ui/custom-field-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { logModuleActivity } from "@/lib/activities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const TIME_OPTIONS = Array.from({ length: 288 }).map((_, i) => {
  const hours24 = Math.floor(i / 12);
  const minutes = (i % 12) * 5;
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const label = `${hours12.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  const value = `${hours24.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
  return { label, value };
});

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  defaultContactId?: string;
  defaultDealId?: string;
  defaultProductId?: string;
  defaultConversationId?: string;
  defaultQuotationId?: string;
  defaultLeadId?: string;
  defaultExpenseId?: string;
  onSaved: () => void;
}

const STATUSES: TaskStatus[] = ["Pending", "In Progress", "Waiting", "Completed", "Cancelled"];
const PRIORITIES: TaskPriority[] = ["Low", "Medium", "High", "Urgent"];

export function TaskForm({
  open,
  onOpenChange,
  task,
  defaultContactId,
  defaultDealId,
  defaultProductId,
  defaultConversationId,
  defaultQuotationId,
  defaultLeadId,
  defaultExpenseId,
  onSaved,
}: TaskFormProps) {
  const supabase = createClient();
  const { user, profile, accountId, accountRole, hasPermission } = useAuth();

  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("Pending");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [activityType, setActivityType] = useState("Task");
  
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [productId, setProductId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [quotationId, setQuotationId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [expenseId, setExpenseId] = useState("");
  
  const [linkedModule, setLinkedModule] = useState<"None"|"Contact"|"Deal"|"Product"|"Conversation"|"Quotation"|"Lead"|"Expense">("None");

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const [taskTypes, setTaskTypes] = useState<string[]>(["Task", "Call", "Visit", "Meeting", "Follow up", "Note"]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetch account settings for task types
  useEffect(() => {
    if (accountId && open) {
      supabase.from('accounts').select('settings').eq('id', accountId).single().then(({ data }) => {
        if (data?.settings?.task_types && Array.isArray(data.settings.task_types)) {
          setTaskTypes(data.settings.task_types);
          if (!task && !activityType) {
            setActivityType(data.settings.task_types[0] || "Task");
          }
        }
      });
    }
  }, [accountId, open, supabase]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setConfirmDelete(false);
      if (task) {
        setDescription(task.description || "");
        setStatus(task.status);
        setPriority(task.priority);
        setAssignedUserId(task.assigned_user_id || "");
        setDueDate(task.due_date ? task.due_date.split("T")[0] : "");
        setDueTime(task.due_time || "");
        setActivityType(task.activity_type || "Task");
        setContactId(task.contact_id || "");
        setDealId(task.deal_id || "");
        setProductId(task.product_id || "");
        setConversationId(task.conversation_id || "");
        setQuotationId(task.quotation_id || "");
        setLeadId(task.lead_id || "");
        setExpenseId(task.expense_id || "");
        if (task.contact_id) setLinkedModule("Contact");
        else if (task.lead_id) setLinkedModule("Lead");
        else if (task.expense_id) setLinkedModule("Expense");
        else if (task.deal_id) setLinkedModule("Deal");
        else if (task.quotation_id) setLinkedModule("Quotation");
        else if (task.product_id) setLinkedModule("Product");
        else if (task.conversation_id) setLinkedModule("Conversation");
        else setLinkedModule("None");
      } else {
        setDescription("");
        setStatus("Pending");
        setPriority("Medium");
        setAssignedUserId(profile?.id || "");
        setDueDate("");
        setDueTime("");
        setActivityType(taskTypes[0] || "Task");
        setContactId(defaultContactId || "");
        setDealId(defaultDealId || "");
        setProductId(defaultProductId || "");
        setConversationId(defaultConversationId || "");
        setQuotationId(defaultQuotationId || "");
        setLeadId(defaultLeadId || "");
        setExpenseId(defaultExpenseId || "");
        
        if (defaultContactId) setLinkedModule("Contact");
        else if (defaultLeadId) setLinkedModule("Lead");
        else if (defaultExpenseId) setLinkedModule("Expense");
        else if (defaultDealId) setLinkedModule("Deal");
        else if (defaultQuotationId) setLinkedModule("Quotation");
        else if (defaultProductId) setLinkedModule("Product");
        else if (defaultConversationId) setLinkedModule("Conversation");
        else setLinkedModule("None");
      }
    }
  }, [open, task, defaultContactId, defaultDealId, defaultProductId, defaultConversationId, defaultQuotationId, defaultLeadId, defaultExpenseId, profile?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [pRes, cRes, dRes, prodRes, convRes, cfRes, qRes, lRes, expRes] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("contacts").select("*").order("name"),
        supabase.from("deals").select("*").order("title"),
        supabase.from("products").select("*").order("name"),
        supabase.from("conversations").select("*, contact:contacts(name, phone)").order("last_message_at", { ascending: false }),
        supabase.from("custom_fields").select("*").eq("module_name", "task").order("field_name"),
        supabase.from("quotations").select("*, contact:contacts(name)").order("quotation_number", { ascending: false }),
        supabase.from("leads").select("*").order("name"),
        supabase.from("expenses").select("*, expense_type:expense_types(expense_name)").order("created_at", { ascending: false })
      ]);
      if (cancelled) return;
      setProfiles((pRes.data ?? []) as Profile[]);
      setContacts((cRes.data ?? []) as Contact[]);
      setDeals((dRes.data ?? []) as Deal[]);
      setProducts((prodRes.data ?? []) as Product[]);
      setConversations((convRes.data ?? []) as Conversation[]);
      setQuotations((qRes.data ?? []) as any[]);
      setLeads((lRes.data ?? []) as any[]);
      setExpenses((expRes.data ?? []) as any[]);
      
      const fields = cfRes.data as CustomField[] ?? [];
      setCustomFields(fields);
      
      if (task?.id) {
        const { data: values } = await supabase
          .from("task_custom_values")
          .select("*")
          .eq("task_id", task.id);
          
        if (cancelled) return;
          
        if (values) {
          const vals: Record<string, string> = {};
          values.forEach((v) => {
            if (v.value) vals[v.custom_field_id] = v.value;
          });
          setCustomValues(vals);
        }
      } else {
        setCustomValues({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, task, supabase]);

  async function handleSave() {
    const isNoteType = activityType.toLowerCase() === "note";
    if (isNoteType && !description.trim()) {
      toast.error("Note text is required");
      return;
    }
    setSaving(true);

    const payload = {
      account_id: accountId,
      title: null, // Title is no longer used, we save to description
      description: description.trim(),
      activity_type: activityType,
      status: activityType.toLowerCase() === "note" ? "Completed" : status,
      priority,
      assigned_user_id: assignedUserId || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      contact_id: linkedModule === "Contact" ? contactId : null,
      deal_id: linkedModule === "Deal" ? dealId : null,
      product_id: linkedModule === "Product" ? productId : null,
      conversation_id: linkedModule === "Conversation" ? conversationId : null,
      quotation_id: linkedModule === "Quotation" ? quotationId : null,
      lead_id: linkedModule === "Lead" ? leadId : null,
      expense_id: linkedModule === "Expense" ? expenseId : null,
    };

    let savedTaskId = task?.id;

    if (task) {
      const { error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", task.id);
      if (error) {
        toast.error("Failed to save task");
        setSaving(false);
        return;
      }
    } else {
      if (!user) {
        toast.error("Not signed in");
        setSaving(false);
        return;
      }
      const { data, error } = await supabase
        .from("tasks")
        .insert({ ...payload, user_id: user.id })
        .select("id")
        .single();
      if (error) {
        console.error("Task Insert Error:", error);
        toast.error(`Failed to create task: ${error.message}`);
        setSaving(false);
        return;
      }
      savedTaskId = data.id;
    }

    if (savedTaskId) {
      const cfUpserts = customFields
        .filter(f => customValues[f.id] !== undefined)
        .map((f) => ({
           task_id: savedTaskId,
           custom_field_id: f.id,
           value: customValues[f.id]
        }));
      
      if (cfUpserts.length > 0) {
        await supabase.from('task_custom_values').delete().eq('task_id', savedTaskId);
        await supabase.from('task_custom_values').insert(cfUpserts);
      }
      
      const logPromises = [];
      const msg = task ? `${activityType} updated` : `${activityType} created`;
      if (contactId) logPromises.push(logModuleActivity(supabase, { moduleName: 'contact', recordId: contactId, action: task ? 'updated' : 'created', message: msg }));
      if (dealId) logPromises.push(logModuleActivity(supabase, { moduleName: 'deal', recordId: dealId, action: task ? 'updated' : 'created', message: msg }));
      if (quotationId) logPromises.push(logModuleActivity(supabase, { moduleName: 'quotation', recordId: quotationId, action: task ? 'updated' : 'created', message: msg }));
      if (productId) logPromises.push(logModuleActivity(supabase, { moduleName: 'product', recordId: productId, action: task ? 'updated' : 'created', message: msg }));
      if (leadId) logPromises.push(logModuleActivity(supabase, { moduleName: 'lead', recordId: leadId, action: task ? 'updated' : 'created', message: msg }));
      if (expenseId) logPromises.push(logModuleActivity(supabase, { moduleName: 'expense', recordId: expenseId, action: task ? 'updated' : 'created', message: msg }));
      await Promise.all(logPromises);
    }

    setSaving(false);
    toast.success(task ? "Saved successfully" : "Created successfully");
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Deleted successfully");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const isNote = activityType.toLowerCase() === "note";
  
  // Use new RBAC permissions for assigning tasks
  const hasAssignPerm = hasPermission("assign_tasks_all") || hasPermission("assign_tasks_parent") || hasPermission("assign_tasks_child");
  const canAssignOthers = accountRole === "admin" || accountRole === "owner" || hasAssignPerm;
  const assignableProfiles = canAssignOthers ? profiles : profiles.filter(p => p.id === user?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("bg-popover border-border text-popover-foreground max-h-[90vh] overflow-y-auto", isNote ? "sm:max-w-xl" : "sm:max-w-3xl")}>
        
        {/* Custom Header similar to Note Screenshot */}
        <div className="flex items-center justify-between border-b border-border pb-4 mb-4 pr-6">
          <h2 className="text-xl font-light text-foreground">{task ? "Edit" : "Add"} {isNote ? "Note" : "Activity"}</h2>
        </div>

        {/* Activity Type Tabs (Always Visible) */}
        <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-md w-fit mb-4">
          {taskTypes.map((type) => (
            <button
              key={type}
              onClick={() => setActivityType(type)}
              className={cn(
                "px-4 py-1.5 text-sm font-semibold rounded transition-colors uppercase",
                activityType === type 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
            >
              {type}
            </button>
          ))}
        </div>

        {isNote ? (
          /* NOTE VIEW */
          <div className="space-y-4">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Note"
              className="min-h-[150px] border-primary/50 focus-visible:ring-primary shadow-sm bg-background text-foreground text-base resize-none"
            />
          </div>
        ) : (
          /* STANDARD ACTIVITY VIEW */
          <div className="space-y-6">
            <div className="space-y-4">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={activityType}
                className="border-primary/50 focus-visible:ring-primary bg-background text-foreground h-11 text-base shadow-sm"
              />

              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground text-xs uppercase font-medium">Scheduled Date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="border-border bg-background text-foreground"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground text-xs uppercase font-medium">Scheduled Time</Label>
                  <SearchableSelect
                    value={dueTime}
                    onChange={setDueTime}
                    options={TIME_OPTIONS}
                    placeholder="Select time"
                    className="h-10 w-full bg-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground text-xs uppercase font-medium">Priority</Label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground text-xs uppercase font-medium">Assigned To</Label>
                  <select
                    value={assignedUserId}
                    onChange={(e) => setAssignedUserId(e.target.value)}
                    disabled={!canAssignOthers}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary disabled:opacity-75"
                  >
                    {canAssignOthers && <option value="">Unassigned</option>}
                    {assignableProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground text-xs uppercase font-medium">Linked To</Label>
                  <select
                    value={linkedModule}
                    onChange={(e) => setLinkedModule(e.target.value as any)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="None">None</option>
                    <option value="Contact">Customer</option>
                    <option value="Lead">Lead</option>
                    <option value="Deal">Deal</option>
                    <option value="Quotation">Quotation</option>
                    <option value="Product">Product</option>
                    <option value="Conversation">Conversation</option>
                    <option value="Expense">Expense</option>
                  </select>
                </div>

                {linkedModule !== "None" && (
                  <div className="grid gap-2">
                    <Label className="text-transparent text-xs hidden md:block">Record</Label>
                    {linkedModule === "Contact" && (
                      <SearchableSelect
                        value={contactId}
                        onChange={setContactId}
                        placeholder="Select Customer..."
                        searchPlaceholder="Search contacts..."
                        options={contacts.map((c) => ({ value: c.id, label: c.name || c.phone }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Lead" && (
                      <SearchableSelect
                        value={leadId}
                        onChange={setLeadId}
                        placeholder="Select Lead..."
                        options={leads.map((l) => ({ value: l.id, label: l.name }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Deal" && (
                      <SearchableSelect
                        value={dealId}
                        onChange={setDealId}
                        placeholder="Select Deal..."
                        options={deals.map((d) => ({ value: d.id, label: d.title }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Quotation" && (
                      <SearchableSelect
                        value={quotationId}
                        onChange={setQuotationId}
                        placeholder="Select Quotation..."
                        options={quotations.map((q) => ({ value: q.id, label: `${q.quotation_number} - ${q.contact?.name || 'Unknown'}` }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Product" && (
                      <SearchableSelect
                        value={productId}
                        onChange={setProductId}
                        placeholder="Select Product..."
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Conversation" && (
                      <SearchableSelect
                        value={conversationId}
                        onChange={setConversationId}
                        placeholder="Select Conversation..."
                        options={conversations.map((c) => ({ value: c.id, label: `${c.contact?.name || c.contact?.phone || 'Unknown'} - ${new Date(c.last_message_at || c.created_at).toLocaleDateString()}` }))}
                        className="h-10 bg-background"
                      />
                    )}
                    {linkedModule === "Expense" && (
                      <SearchableSelect
                        value={expenseId}
                        onChange={setExpenseId}
                        placeholder="Select Expense..."
                        options={expenses.map((e) => ({ value: e.id, label: `${e.expense_type?.expense_name} - ₹${e.amount}` }))}
                        className="h-10 bg-background"
                      />
                    )}
                  </div>
                )}
              </div>

              {customFields.length > 0 && (
                <div className="space-y-4 pt-4 mt-4 border-t border-border/50">
                  <h4 className="text-sm font-medium text-foreground">Custom Fields</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {customFields.map((field) => (
                      <div key={field.id} className="grid gap-2">
                        <Label className="text-muted-foreground capitalize">
                          {field.field_name}
                        </Label>
                        <CustomFieldInput 
                          field={field} 
                          value={customValues[field.id] ?? ''} 
                          onChange={(val) => setCustomValues((prev) => ({ ...prev, [field.id]: val }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Area */}
        <div className="flex justify-between items-center w-full mt-6 pt-4 border-t border-border">
          <div className="flex-1">
            {task && !isNote &&
              (confirmDelete ? (
                <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs w-max">
                  <span className="text-red-300">Delete this?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 w-max"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ))}
          </div>
          <div className="flex gap-2 justify-end shrink-0">
            <Button
              onClick={handleSave}
              disabled={saving || (isNote && !description.trim())}
              className="bg-blue-500 text-white hover:bg-blue-600 px-6 font-semibold"
            >
              {saving ? "SAVING..." : "SAVE"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

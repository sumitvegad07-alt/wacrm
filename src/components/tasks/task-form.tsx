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
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const TIME_OPTIONS = Array.from({ length: 48 }).map((_, i) => {
  const hours24 = Math.floor(i / 2);
  const minutes = i % 2 === 0 ? "00" : "30";
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const label = `${hours12}:${minutes} ${ampm}`;
  const value = `${hours24.toString().padStart(2, "0")}:${minutes}:00`;
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
  onSaved,
}: TaskFormProps) {
  const supabase = createClient();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("Pending");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [productId, setProductId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [quotationId, setQuotationId] = useState("");

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setConfirmDelete(false);
      if (task) {
        setTitle(task.title || "");
        setDescription(task.description || "");
        setStatus(task.status);
        setPriority(task.priority);
        setAssignedUserId(task.assigned_user_id || "");
        setDueDate(task.due_date ? task.due_date.split("T")[0] : "");
        setDueTime(task.due_time || "");
        setContactId(task.contact_id || "");
        setDealId(task.deal_id || "");
        setProductId(task.product_id || "");
        setConversationId(task.conversation_id || "");
        setQuotationId(task.quotation_id || "");
      } else {
        setTitle("");
        setDescription("");
        setStatus("Pending");
        setPriority("Medium");
        setAssignedUserId("");
        setDueDate("");
        setDueTime("");
        setContactId(defaultContactId || "");
        setDealId(defaultDealId || "");
        setProductId(defaultProductId || "");
        setConversationId(defaultConversationId || "");
        setQuotationId(defaultQuotationId || "");
      }
    }
  }, [open, task, defaultContactId, defaultDealId, defaultProductId, defaultConversationId, defaultQuotationId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [pRes, cRes, dRes, prodRes, convRes, cfRes, qRes] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("contacts").select("*").order("name"),
        supabase.from("deals").select("*").order("title"),
        supabase.from("products").select("*").order("name"),
        supabase.from("conversations").select("*, contact:contacts(name, phone)").order("last_message_at", { ascending: false }),
        supabase.from("custom_fields").select("*").eq("module_name", "task").order("field_name"),
        supabase.from("quotations").select("*, contact:contacts(name)").order("quotation_number", { ascending: false })
      ]);
      if (cancelled) return;
      setProfiles((pRes.data ?? []) as Profile[]);
      setContacts((cRes.data ?? []) as Contact[]);
      setDeals((dRes.data ?? []) as Deal[]);
      setProducts((prodRes.data ?? []) as Product[]);
      setConversations((convRes.data ?? []) as Conversation[]);
      setQuotations((qRes.data ?? []) as any[]);
      
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
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      assigned_user_id: assignedUserId || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      contact_id: contactId || null,
      deal_id: dealId || null,
      product_id: productId || null,
      conversation_id: conversationId || null,
      quotation_id: quotationId || null,
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
      const msg = task ? `Task updated: ${title}` : `Task generated: ${title}`;
      if (contactId) logPromises.push(logModuleActivity(supabase, { moduleName: 'contact', recordId: contactId, action: task ? 'updated' : 'created', message: msg }));
      if (dealId) logPromises.push(logModuleActivity(supabase, { moduleName: 'deal', recordId: dealId, action: task ? 'updated' : 'created', message: msg }));
      if (quotationId) logPromises.push(logModuleActivity(supabase, { moduleName: 'quotation', recordId: quotationId, action: task ? 'updated' : 'created', message: msg }));
      if (productId) logPromises.push(logModuleActivity(supabase, { moduleName: 'product', recordId: productId, action: task ? 'updated' : 'created', message: msg }));
      await Promise.all(logPromises);
    }

    setSaving(false);
    toast.success(task ? "Task updated" : "Task created");
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete task");
      return;
    }
    toast.success("Task deleted");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground text-xl">
            {task ? "Edit Task" : "New Task"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {task ? "Update the task details below." : "Fill in the details to create a new task."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Primary Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Title <span className="text-red-400">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Follow up with client"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2 md:col-span-2">
              <Label className="text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Task details..."
                className="min-h-[80px] border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Status</Label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Priority</Label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">Assigned To</Label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Unassigned</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Scheduled Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Scheduled Time</Label>
              <select
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Any time</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-border/50 pt-4 mt-4 space-y-4 md:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Linked Contact</Label>
                <SearchableSelect
                  value={contactId}
                  onChange={setContactId}
                  placeholder="None"
                  searchPlaceholder="Search contacts..."
                  emptyMessage="No contacts found."
                  options={contacts.map((c) => ({
                    value: c.id,
                    label: c.name || c.phone,
                  }))}
                />
              </div>
              
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Linked Deal</Label>
                <SearchableSelect
                  value={dealId}
                  onChange={setDealId}
                  placeholder="None"
                  searchPlaceholder="Search deals..."
                  emptyMessage="No deals found."
                  options={deals.map((d) => ({
                    value: d.id,
                    label: d.title,
                  }))}
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">Linked Product</Label>
                <SearchableSelect
                  value={productId}
                  onChange={setProductId}
                  placeholder="None"
                  searchPlaceholder="Search products..."
                  emptyMessage="No products found."
                  options={products.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">Linked Quotation</Label>
                <SearchableSelect
                  value={quotationId}
                  onChange={setQuotationId}
                  placeholder="None"
                  searchPlaceholder="Search quotations..."
                  emptyMessage="No quotations found."
                  options={quotations.map((q) => ({
                    value: q.id,
                    label: `${q.quotation_number} (v${q.version}) - ${q.contact?.name || 'Unknown'}`,
                  }))}
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">Linked Conversation</Label>
                <SearchableSelect
                  value={conversationId}
                  onChange={setConversationId}
                  placeholder="None"
                  searchPlaceholder="Search conversations..."
                  emptyMessage="No conversations found."
                  options={conversations.map((c) => ({
                    value: c.id,
                    label: `${c.contact?.name || c.contact?.phone || 'Unknown'} - ${new Date(c.last_message_at || c.created_at).toLocaleDateString()}`,
                  }))}
                />
              </div>
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
        </div>
        </div>

        <DialogFooter className="bg-popover border-border sm:justify-between items-center w-full mt-6 flex-row gap-4">
          <div className="flex-1">
          {task &&
            (confirmDelete ? (
              <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs w-max">
                <span className="text-red-300">Delete this task?</span>
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
                <Trash2 className="h-3 w-3" />
                Delete Task
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end shrink-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving..." : task ? "Save Changes" : "Create Task"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

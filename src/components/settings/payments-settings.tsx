"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Edit2, GripVertical, ShieldCheck, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface PaymentType {
  id: string;
  account_id: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
  position: number;
}

const DEFAULT_SYSTEM_TYPES = ["Cash", "Cheque", "UPI", "NEFT", "RTGS", "Bank Transfer", "Credit Note", "Other"];

function SortablePaymentTypeItem({ 
  type, 
  onEdit, 
  onDelete,
  canEdit
}: { 
  type: PaymentType, 
  onEdit: (t: PaymentType) => void, 
  onDelete: (id: string) => void,
  canEdit: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: type.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} className={`p-4 flex items-center justify-between transition-colors bg-card ${isDragging ? 'bg-muted/50 border border-primary/50 rounded-md shadow-sm' : 'hover:bg-muted/30'}`}>
      <div className="flex items-center gap-3">
        {canEdit && (
          <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
            <GripVertical className="h-5 w-5" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{type.name}</h4>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${type.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              {type.is_active ? 'Active' : 'Disabled'}
            </span>
            {type.is_system && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                System
              </span>
            )}
          </div>
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => onEdit(type)}>
            <Edit2 className="h-4 w-4" />
          </Button>
          {!type.is_system && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(type.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [paymentTypes, setPaymentTypes] = useState<PaymentType[]>([]);
  
  // Section 2: Financial Controls state
  const [paymentApprovalRequired, setPaymentApprovalRequired] = useState(true);
  const [enableCreditLimit, setEnableCreditLimit] = useState(false);
  const [enableCreditDays, setEnableCreditDays] = useState(false);
  const [requireAttachment, setRequireAttachment] = useState(false);
  const [requireNotes, setRequireNotes] = useState(false);
  const [requirePaymentReference, setRequirePaymentReference] = useState(false);
  
  const [creditLimitEnforcement, setCreditLimitEnforcement] = useState<'warn' | 'block'>('warn');
  const [creditDaysEnforcement, setCreditDaysEnforcement] = useState<'warn' | 'block'>('warn');

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typeName, setTypeName] = useState("");
  const [typeActive, setTypeActive] = useState(true);
  const [savingType, setSavingType] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (accountId) {
      loadData();
    }
  }, [accountId]);

  async function loadData() {
    setLoading(true);
    
    // Load payment types
    const { data: types, error: typesError } = await supabase
      .from('payment_types')
      .select('*')
      .eq('account_id', accountId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
      
    if (typesError) {
      toast.error('Failed to load payment types');
    } else {
      if (!types || types.length === 0) {
        // Seed system types
        const typesToInsert = DEFAULT_SYSTEM_TYPES.map((name, i) => ({
          account_id: accountId,
          name,
          is_system: true,
          is_active: true,
          position: i,
        }));
        const { data: newTypes, error: seedError } = await supabase
          .from('payment_types')
          .insert(typesToInsert)
          .select();
          
        if (!seedError && newTypes) {
          setPaymentTypes(newTypes.sort((a,b)=>a.position - b.position));
        } else {
          setPaymentTypes([]);
        }
      } else {
        setPaymentTypes(types);
      }
    }
    
    // Load settings
    const { data: accData } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
    if (accData) {
      const s = accData.settings || {};
      const ps = s.payment_settings || {};
      
      setPaymentApprovalRequired(ps.approval_required ?? true);
      setEnableCreditLimit(ps.enable_credit_limit ?? false);
      setEnableCreditDays(ps.enable_credit_days ?? false);
      setRequireAttachment(ps.require_attachment ?? false);
      setRequireNotes(ps.require_notes ?? false);
      setRequirePaymentReference(ps.require_reference ?? false);
      
      setCreditLimitEnforcement(ps.credit_limit_enforcement ?? 'warn');
      setCreditDaysEnforcement(ps.credit_days_enforcement ?? 'warn');
    }
    setLoading(false);
  }

  async function updateSetting(key: string, value: any) {
    if (!canEditSettings) {
      toast.error('Permission denied');
      return;
    }
    
    const { data: accData } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
    if (!accData) return;
    
    const s = accData.settings || {};
    const ps = s.payment_settings || {};
    
    const newSettings = {
      ...s,
      payment_settings: {
        ...ps,
        [key]: value
      }
    };
    
    const { error } = await supabase.from('accounts').update({ settings: newSettings }).eq('id', accountId);
    if (error) {
      toast.error('Failed to update setting');
    } else {
      toast.success('Setting updated');
    }
  }

  const resetForm = () => {
    setEditingId(null);
    setTypeName("");
    setTypeActive(true);
  };

  const handleEdit = (t: PaymentType) => {
    setEditingId(t.id);
    setTypeName(t.name);
    setTypeActive(t.is_active);
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this payment type? It will fail if already used in payments.")) return;
    const { error } = await supabase.from("payment_types").delete().eq("id", id);
    if (error) {
      toast.error("Cannot delete payment type. It might be used by existing payments.");
    } else {
      toast.success("Payment type deleted");
      setPaymentTypes(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleSaveType = async () => {
    if (!typeName.trim()) {
      toast.error("Payment type name is required");
      return;
    }
    setSavingType(true);
    
    const payload = {
      account_id: accountId,
      name: typeName.trim(),
      is_active: typeActive,
      // If creating new, set position to end
      ...(editingId ? {} : { position: paymentTypes.length, is_system: false })
    };

    if (editingId) {
      const { data, error } = await supabase.from("payment_types").update(payload).eq("id", editingId).select();
      if (error) toast.error(error.message);
      else {
        toast.success("Payment type updated");
        setPaymentTypes(prev => prev.map(p => p.id === editingId ? data[0] : p));
        setIsDialogOpen(false);
      }
    } else {
      const { data, error } = await supabase.from("payment_types").insert(payload).select();
      if (error) toast.error(error.message);
      else {
        toast.success("Payment type added");
        setPaymentTypes(prev => [...prev, data[0]]);
        setIsDialogOpen(false);
      }
    }
    setSavingType(false);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && canEditSettings) {
      const oldIndex = paymentTypes.findIndex((t) => t.id === active.id);
      const newIndex = paymentTypes.findIndex((t) => t.id === over.id);
      const newTypes = arrayMove(paymentTypes, oldIndex, newIndex);
      
      // Optimistic update
      setPaymentTypes(newTypes);
      
      // Update DB
      const updates = newTypes.map((t, i) => ({
        id: t.id,
        account_id: t.account_id,
        name: t.name, // required for unique constraint handling sometimes if doing upsert, but we'll use a transaction via rpc or individual updates if needed.
        position: i
      }));
      
      // Since it's a few items, doing loop updates or an upsert is fine
      // Upsert needs to include all required fields. We have them in `newTypes`.
      const { error } = await supabase.from('payment_types').upsert(
        newTypes.map((t, i) => ({
          ...t,
          position: i,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'id' }
      );
      
      if (error) {
        toast.error("Failed to save order");
        loadData(); // revert
      } else {
        toast.success("Order saved");
      }
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/> Loading payment settings...</div>;
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Payments"
        description="Configure payment methods and financial controls for order processing."
      />
      
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: PAYMENT TYPES */}
        <div className="xl:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Payment Types</h3>
              <p className="text-sm text-muted-foreground">
                Manage available payment methods. Drag to reorder.
              </p>
            </div>
            {canEditSettings && (
              <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (open) resetForm();
              }}>
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Payment Type
                  </Button>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{editingId ? "Edit Payment Type" : "Add Payment Type"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input 
                        placeholder="e.g. PayPal" 
                        value={typeName} 
                        onChange={(e) => setTypeName(e.target.value)} 
                        disabled={editingId ? paymentTypes.find(t => t.id === editingId)?.is_system : false}
                      />
                      {editingId && paymentTypes.find(t => t.id === editingId)?.is_system && (
                        <p className="text-xs text-muted-foreground">System payment type names cannot be changed.</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 pt-2">
                      <Switch 
                        id="type-active" 
                        checked={typeActive} 
                        onCheckedChange={setTypeActive} 
                      />
                      <Label htmlFor="type-active" className="text-sm">Active</Label>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleSaveType} disabled={savingType}>{savingType ? "Saving..." : "Save"}</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            {paymentTypes.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                <Wallet className="h-10 w-10 mb-2 opacity-50" />
                <p>No payment types found.</p>
              </div>
            ) : (
              <DndContext 
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext 
                  items={paymentTypes.map(t => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y">
                    {paymentTypes.map((t) => (
                      <SortablePaymentTypeItem 
                        key={t.id} 
                        type={t} 
                        onEdit={handleEdit} 
                        onDelete={handleDelete}
                        canEdit={canEditSettings}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: FINANCIAL CONTROLS */}
        <div className="xl:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Financial Controls
              </CardTitle>
              <CardDescription className="text-xs">
                Manage global rules for payment collections and credits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              
              <div className="flex items-center justify-between border-b pb-4">
                <div className="space-y-0.5 pr-4">
                  <h4 className="text-sm font-medium">Payment Approval Required</h4>
                  <p className="text-xs text-muted-foreground">
                    Require manager approval for collected payments.
                  </p>
                </div>
                <Switch 
                  checked={paymentApprovalRequired} 
                  onCheckedChange={(val) => { setPaymentApprovalRequired(val); updateSetting('approval_required', val); }}
                  disabled={!canEditSettings}
                />
              </div>
              
              <div className="space-y-3 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <h4 className="text-sm font-medium">Enable Credit Limit</h4>
                    <p className="text-xs text-muted-foreground">
                      Restrict orders for customers exceeding limit.
                    </p>
                  </div>
                  <Switch 
                    checked={enableCreditLimit} 
                    onCheckedChange={(val) => { setEnableCreditLimit(val); updateSetting('enable_credit_limit', val); }}
                    disabled={!canEditSettings}
                  />
                </div>
                {enableCreditLimit && (
                  <div className="pl-2 pt-1">
                    <Label className="text-xs mb-1 block text-muted-foreground">Enforcement</Label>
                    <Select 
                      value={creditLimitEnforcement} 
                      onValueChange={(val: any) => { setCreditLimitEnforcement(val); updateSetting('credit_limit_enforcement', val); }}
                      disabled={!canEditSettings}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="warn">Warn Only</SelectItem>
                        <SelectItem value="block">Block Orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <h4 className="text-sm font-medium">Enable Credit Days</h4>
                    <p className="text-xs text-muted-foreground">
                      Track overdue payments based on credit days.
                    </p>
                  </div>
                  <Switch 
                    checked={enableCreditDays} 
                    onCheckedChange={(val) => { setEnableCreditDays(val); updateSetting('enable_credit_days', val); }}
                    disabled={!canEditSettings}
                  />
                </div>
                {enableCreditDays && (
                  <div className="pl-2 pt-1">
                    <Label className="text-xs mb-1 block text-muted-foreground">Enforcement</Label>
                    <Select 
                      value={creditDaysEnforcement} 
                      onValueChange={(val: any) => { setCreditDaysEnforcement(val); updateSetting('credit_days_enforcement', val); }}
                      disabled={!canEditSettings}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="warn">Warn Only</SelectItem>
                        <SelectItem value="block">Block Orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between border-b pb-4">
                <div className="space-y-0.5 pr-4">
                  <h4 className="text-sm font-medium">Require Attachment</h4>
                  <p className="text-xs text-muted-foreground">
                    Collectors must attach a receipt photo, and a payment cannot be
                    approved until its proof has arrived.
                  </p>
                </div>
                <Switch 
                  checked={requireAttachment} 
                  onCheckedChange={(val) => { setRequireAttachment(val); updateSetting('require_attachment', val); }}
                  disabled={!canEditSettings}
                />
              </div>

              <div className="flex items-center justify-between border-b pb-4">
                <div className="space-y-0.5 pr-4">
                  <h4 className="text-sm font-medium">Require Notes</h4>
                  <p className="text-xs text-muted-foreground">
                    Mandate a note/description for all payments.
                  </p>
                </div>
                <Switch 
                  checked={requireNotes} 
                  onCheckedChange={(val) => { setRequireNotes(val); updateSetting('require_notes', val); }}
                  disabled={!canEditSettings}
                />
              </div>

              <div className="flex items-center justify-between pb-1">
                <div className="space-y-0.5 pr-4">
                  <h4 className="text-sm font-medium">Require Payment Reference</h4>
                  <p className="text-xs text-muted-foreground">
                    Mandate a reference number for instruments that carry one — cheque,
                    UPI, NEFT, RTGS and bank transfer. Cash is never asked for one.
                  </p>
                </div>
                <Switch 
                  checked={requirePaymentReference} 
                  onCheckedChange={(val) => { setRequirePaymentReference(val); updateSetting('require_reference', val); }}
                  disabled={!canEditSettings}
                />
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


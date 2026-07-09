"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Edit2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ExpenseType, AllowanceType, IsPerKm } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ExpenseTypesSettings() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  
  const [requireOdometer, setRequireOdometer] = useState(false);
  const [savingOdometer, setSavingOdometer] = useState(false);
  
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form State
  const [allowanceType, setAllowanceType] = useState<AllowanceType>("REGULAR");
  const [expenseName, setExpenseName] = useState("");
  const [defaultAmount, setDefaultAmount] = useState("0");
  const [amountChangeable, setAmountChangeable] = useState(true);
  const [proofRequired, setProofRequired] = useState(false);
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [isPerKm, setIsPerKm] = useState<IsPerKm>("NO");
  const [ratePerKm, setRatePerKm] = useState("0");
  const [enableRateTiers, setEnableRateTiers] = useState(false);
  const [rateTiers, setRateTiers] = useState<any[]>([]);
  const [availableDesignations, setAvailableDesignations] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (accountId) {
      fetchExpenseTypes();
      fetchAccountSettings();
      fetchDesignations();
    }
  }, [accountId]);

  async function fetchAccountSettings() {
    const { data } = await supabase.from('accounts').select('require_odometer').eq('id', accountId).single();
    if (data) setRequireOdometer(data.require_odometer);
  }

  async function fetchDesignations() {
    // Get unique designations from profiles
    const { data } = await supabase.from('profiles').select('designation').eq('account_id', accountId).not('designation', 'is', null);
    if (data) {
      const unique = Array.from(new Set(data.map(d => d.designation).filter(Boolean)));
      setAvailableDesignations(unique as string[]);
    }
  }

  const handleToggleOdometer = async (checked: boolean) => {
    setRequireOdometer(checked);
    setSavingOdometer(true);
    const { error } = await supabase.from('accounts').update({ require_odometer: checked }).eq('id', accountId);
    if (error) {
      toast.error('Failed to update odometer setting');
      setRequireOdometer(!checked);
    } else {
      toast.success('Settings updated');
    }
    setSavingOdometer(false);
  };

  async function fetchExpenseTypes() {
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_types")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load expense types");
    } else {
      setExpenseTypes(data as ExpenseType[]);
    }
    setLoading(false);
  }

  const resetForm = () => {
    setEditingId(null);
    setAllowanceType("REGULAR");
    setExpenseName("");
    setDefaultAmount("0");
    setAmountChangeable(true);
    setProofRequired(false);
    setStatus("Active");
    setIsPerKm("NO");
    setRatePerKm("0");
    setEnableRateTiers(false);
    setRateTiers([]);
  };

  const handleEdit = (et: ExpenseType) => {
    setEditingId(et.id);
    setAllowanceType(et.allowance_type);
    setExpenseName(et.expense_name);
    setDefaultAmount(et.default_amount.toString());
    setAmountChangeable(et.amount_changeable);
    setProofRequired(et.proof_required);
    setStatus(et.status);
    setIsPerKm(et.is_per_km);
    setRatePerKm(et.rate_per_km.toString());
    setEnableRateTiers(et.enable_rate_tiers || false);
    
    // Fetch rate tiers
    supabase.from('expense_rate_tiers').select('*').eq('expense_type_id', et.id)
      .then(({ data }) => {
        if (data) setRateTiers(data);
      });
      
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense type? It will fail if already used in expenses.")) return;
    
    const { error } = await supabase.from("expense_types").delete().eq("id", id);
    if (error) {
      toast.error("Cannot delete expense type. It might be used by existing expenses.");
    } else {
      toast.success("Expense type deleted");
      fetchExpenseTypes();
    }
  };

  const handleSave = async () => {
    if (!expenseName.trim()) {
      toast.error("Expense name is required");
      return;
    }

    setSaving(true);
    const payload = {
      account_id: accountId,
      allowance_type: allowanceType,
      expense_name: expenseName.trim(),
      default_amount: parseFloat(defaultAmount) || 0,
      amount_changeable: amountChangeable,
      proof_required: proofRequired,
      status,
      is_per_km: allowanceType === "TRAVELLING" ? isPerKm : "NO",
      rate_per_km: allowanceType === "TRAVELLING" && isPerKm !== "NO" ? parseFloat(ratePerKm) || 0 : 0,
      enable_rate_tiers: enableRateTiers,
      created_by: user?.id,
    };

    let err;
    let savedData;
    if (editingId) {
      const { data, error } = await supabase.from("expense_types").update(payload).eq("id", editingId).select();
      err = error;
      savedData = data;
    } else {
      const { data, error } = await supabase.from("expense_types").insert(payload).select();
      err = error;
      savedData = data;
    }

    if (err) {
      toast.error(err.message || "Failed to save expense type");
      setSaving(false);
      return;
    }

    const savedId = editingId || savedData?.[0]?.id || (editingId === null && await supabase.from('expense_types').select('id').eq('expense_name', payload.expense_name).order('created_at', { ascending: false }).limit(1).single().then(r => r.data?.id));
    
    if (savedId) {
      // Save Rate Tiers
      await supabase.from('expense_rate_tiers').delete().eq('expense_type_id', savedId);
      if (payload.enable_rate_tiers && rateTiers.length > 0) {
        const tiersToInsert = rateTiers.map(t => ({
          expense_type_id: savedId,
          designation: t.designation,
          default_amount: parseFloat(t.default_amount) || 0,
          rate_per_km: parseFloat(t.rate_per_km) || 0,
        }));
        await supabase.from('expense_rate_tiers').insert(tiersToInsert);
      }
    }

    toast.success("Expense type saved!");
    setIsDialogOpen(false);
    resetForm();
    fetchExpenseTypes();
    setSaving(false);
  };

  const addRateTier = () => {
    setRateTiers([...rateTiers, { designation: '', default_amount: '0', rate_per_km: '0' }]);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading expense policies...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-muted/20 p-4 rounded-lg border">
        <div>
          <h3 className="text-sm font-medium">Require Odometer Photo</h3>
          <p className="text-sm text-muted-foreground">
            Force field staff to take a live photo of their vehicle odometer during Punch In/Out.
          </p>
        </div>
        <Switch checked={requireOdometer} onCheckedChange={handleToggleOdometer} disabled={savingOdometer} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Expense Policies</h3>
          <p className="text-sm text-muted-foreground">
            Configure the types of expenses and allowances your employees can claim.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (open) {
            resetForm();
          }
        }}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" /> Add Expense Type
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit" : "New"} Expense Type</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Allowance Type</Label>
                  <Select value={allowanceType} onValueChange={(val: any) => setAllowanceType(val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REGULAR">Regular Expense</SelectItem>
                      <SelectItem value="TRAVELLING">Travelling Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(val: any) => setStatus(val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Expense Name</Label>
                <Input 
                  placeholder="e.g. Food, Hotel Stay, Taxi" 
                  value={expenseName} 
                  onChange={(e) => setExpenseName(e.target.value)} 
                />
              </div>

              {allowanceType === "TRAVELLING" && (
                <div className="space-y-2 p-4 border rounded-md bg-muted/20">
                  <Label className="mb-2 block font-semibold text-primary">Travel Settings</Label>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>Is Per KM?</Label>
                      <Select value={isPerKm} onValueChange={(val: any) => setIsPerKm(val)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NO">No (Flat rate / user entry)</SelectItem>
                          <SelectItem value="SYSTEM">As Per System (GPS Tracking)</SelectItem>
                          <SelectItem value="USER">As Per User (Manual KM Entry)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {isPerKm !== "NO" && (
                      <div className="space-y-2">
                        <Label>Rate Per KM (₹)</Label>
                        <Input 
                          type="number" 
                          value={ratePerKm} 
                          onChange={(e) => setRatePerKm(e.target.value)} 
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Amount (₹)</Label>
                  <Input 
                    type="number" 
                    value={defaultAmount} 
                    onChange={(e) => setDefaultAmount(e.target.value)} 
                    disabled={allowanceType === "TRAVELLING" && isPerKm !== "NO"}
                  />
                  {allowanceType === "TRAVELLING" && isPerKm !== "NO" && (
                    <p className="text-xs text-muted-foreground">Amount calculated automatically via KM * Rate.</p>
                  )}
                </div>
                
                <div className="space-y-3 pt-6">
                  <div className="flex items-center space-x-2">
                    <Switch 
                      id="changeable" 
                      checked={amountChangeable} 
                      onCheckedChange={setAmountChangeable} 
                    />
                    <Label htmlFor="changeable" className="font-normal cursor-pointer">Employee can edit amount/rate</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch 
                      id="proof" 
                      checked={proofRequired} 
                      onCheckedChange={setProofRequired} 
                    />
                    <Label htmlFor="proof" className="font-normal cursor-pointer">Image proof is mandatory</Label>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">Enable Rate Tiers</Label>
                    <p className="text-sm text-muted-foreground">Override the default rate for specific designations (e.g. Sales Executive vs ASM)</p>
                  </div>
                  <Switch checked={enableRateTiers} onCheckedChange={setEnableRateTiers} />
                </div>
                
                {enableRateTiers && (
                  <div className="space-y-4 bg-muted/20 p-4 rounded-lg border">
                    {rateTiers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-2">No rate tiers configured.</p>
                    ) : (
                      <div className="space-y-3">
                        {rateTiers.map((tier, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1 space-y-1">
                              <Label className="text-xs">Designation</Label>
                              <Select 
                                value={tier.designation} 
                                onValueChange={(val) => {
                                  const nt = [...rateTiers];
                                  nt[index].designation = val;
                                  setRateTiers(nt);
                                }}
                              >
                                <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                                <SelectContent>
                                  {availableDesignations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label className="text-xs">Amount</Label>
                              <Input 
                                type="number" 
                                value={tier.default_amount} 
                                onChange={(e) => {
                                  const nt = [...rateTiers];
                                  nt[index].default_amount = e.target.value;
                                  setRateTiers(nt);
                                }} 
                              />
                            </div>
                            {allowanceType === "TRAVELLING" && isPerKm !== "NO" && (
                              <div className="flex-1 space-y-1">
                                <Label className="text-xs">Rate/KM</Label>
                                <Input 
                                  type="number" 
                                  value={tier.rate_per_km} 
                                  onChange={(e) => {
                                    const nt = [...rateTiers];
                                    nt[index].rate_per_km = e.target.value;
                                    setRateTiers(nt);
                                  }} 
                                />
                              </div>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="mt-5 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                const nt = [...rateTiers];
                                nt.splice(index, 1);
                                setRateTiers(nt);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button variant="outline" size="sm" onClick={addRateTier} className="w-full mt-2 border-dashed">
                      <Plus className="h-4 w-4 mr-2" /> Add Rate Tier
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Expense Type"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        {expenseTypes.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
            <Wallet className="h-10 w-10 mb-2 opacity-50" />
            <p>No expense types configured.</p>
          </div>
        ) : (
          <div className="divide-y">
            {expenseTypes.map((et) => (
              <div key={et.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{et.expense_name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${et.status === 'Active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                      {et.status}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {et.allowance_type}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex gap-4">
                    <span>
                      {et.is_per_km !== 'NO' 
                        ? `Rate: ₹${et.rate_per_km}/km (${et.is_per_km})`
                        : `Default: ₹${et.default_amount}`
                      }
                    </span>
                    <span>•</span>
                    <span>{et.amount_changeable ? "Editable" : "Fixed"}</span>
                    <span>•</span>
                    <span>{et.proof_required ? "Proof Required" : "No Proof Req."}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(et)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(et.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

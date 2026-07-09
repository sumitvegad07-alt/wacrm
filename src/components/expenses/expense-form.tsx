"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Expense, ExpenseType, Profile, CustomField } from "@/types";
import { cn } from "@/lib/utils";
import { CustomFieldInput } from "@/components/ui/custom-field-input";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// We define a flexible schema since fields change based on expense type
const expenseSchema = z.object({
  expense_type_id: z.string().min(1, "Expense type is required"),
  expense_date: z.date(),
  amount: z.number().min(0, "Amount must be positive").optional(),
  travel_km: z.number().min(0, "KM must be positive").optional(),
  remarks: z.string().optional(),
  proof_file: z.any().optional(),
});

type FormValues = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense | null;
  onSaved: () => void;
}

export function ExpenseForm({ open, onOpenChange, expense, onSaved }: ExpenseFormProps) {
  const { accountId, profile, accountRole } = useAuth();
  const isAdmin = accountRole === 'admin' || accountRole === 'owner';
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
  const [selectedType, setSelectedType] = useState<ExpenseType | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  
  const [resolvedAmount, setResolvedAmount] = useState<number | null>(null);
  const [resolvedRate, setResolvedRate] = useState<number | null>(null);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      expense_date: new Date(),
      remarks: "",
      amount: 0,
      travel_km: 0,
    },
  });

  useEffect(() => {
    if (open && accountId) {
      loadExpenseTypes();
    }
  }, [open, accountId]);

  useEffect(() => {
    if (open && expense) {
      form.reset({
        expense_type_id: expense.expense_type_id,
        expense_date: new Date(expense.expense_date),
        amount: expense.amount,
        travel_km: expense.travel_km || 0,
        remarks: expense.remarks || "",
      });
      const type = expenseTypes.find(t => t.id === expense.expense_type_id);
      setSelectedType(type || null);
    } else if (open) {
      form.reset({
        expense_type_id: "",
        expense_date: new Date(),
        amount: 0,
        travel_km: 0,
        remarks: "",
      });
      setSelectedType(null);
      setProofFile(null);
    }
  }, [open, expense, expenseTypes, form]);

  async function loadExpenseTypes() {
    const { data: typesData } = await supabase
      .from("expense_types")
      .select("*")
      .eq("account_id", accountId)
      .eq("status", "Active");
    if (typesData) setExpenseTypes(typesData as ExpenseType[]);

    const { data: cfData } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("account_id", accountId)
      .eq("module_name", "expense")
      .order("field_name");
    
    if (cfData) {
      setCustomFields(cfData as CustomField[]);
      if (expense?.id) {
        const { data: vals } = await supabase.from("expense_custom_values").select("*").eq("expense_id", expense.id);
        if (vals) {
          const cv: Record<string, string> = {};
          vals.forEach(v => { if (v.value) cv[v.custom_field_id] = v.value; });
          setCustomValues(cv);
        }
      } else {
        setCustomValues({});
      }
    }
  }

  const handleTypeChange = async (typeId: string) => {
    form.setValue("expense_type_id", typeId);
    const type = expenseTypes.find(t => t.id === typeId);
    setSelectedType(type || null);
    
    if (type) {
      let activeAmount = type.default_amount;
      let activeRate = type.rate_per_km;
      
      // Resolve Rate Tier
      if (type.enable_rate_tiers && profile) {
        const { data: tier } = await supabase
          .from('expense_rate_tiers')
          .select('*')
          .eq('expense_type_id', type.id)
          .or(`designation.eq.${profile.designation},employee_role_id.eq.${profile.employee_role_id}`)
          .limit(1)
          .maybeSingle();
          
        if (tier) {
          activeAmount = tier.default_amount;
          activeRate = tier.rate_per_km;
        }
      }
      
      setResolvedAmount(activeAmount);
      setResolvedRate(activeRate);
      
      if (type.is_per_km === "NO") {
        form.setValue("amount", activeAmount);
      } else {
        form.setValue("amount", 0);
      }
      form.setValue("travel_km", 0);
    }
  };

  const handleKmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const km = parseFloat(e.target.value) || 0;
    form.setValue("travel_km", km);
    if (selectedType && selectedType.is_per_km !== "NO") {
      const rate = resolvedRate !== null ? resolvedRate : selectedType.rate_per_km;
      form.setValue("amount", km * rate);
    }
  };

  const onSubmit = async (data: FormValues) => {
    if (!profile) return;
    
    if (selectedType?.proof_required && !proofFile && !expense?.proof_file) {
      toast.error("Proof file is required for this expense type");
      return;
    }

    setLoading(true);

    let proofUrl = expense?.proof_file || null;

    if (proofFile) {
      const fileExt = proofFile.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${accountId}/${profile.id}/${fileName}`;
      
      const { error: uploadError, data: uploadData } = await supabase.storage
        .from('expense_proofs')
        .upload(filePath, proofFile);
        
      if (uploadError) {
        // If bucket doesn't exist, we fallback
        console.error("Storage upload error", uploadError);
        toast.error("Could not upload file. Ensure 'expense_proofs' bucket exists.");
        setLoading(false);
        return;
      }
      
      const { data: publicUrlData } = supabase.storage.from('expense_proofs').getPublicUrl(filePath);
      proofUrl = publicUrlData.publicUrl;
    }

    const payload = {
      account_id: accountId,
      employee_id: profile.id, // Current user claims expense
      expense_type_id: data.expense_type_id,
      expense_date: format(data.expense_date, "yyyy-MM-dd"),
      amount: data.amount,
      travel_km: selectedType?.allowance_type === "TRAVELLING" ? data.travel_km : null,
      rate_per_km: selectedType?.is_per_km !== "NO" ? (resolvedRate !== null ? resolvedRate : selectedType?.rate_per_km) : null,
      remarks: data.remarks,
      proof_file: proofUrl,
      status: "Pending", // Reset to pending if edited by employee
    };

    let savedId = expense?.id;
    let error: any = null;
    if (expense) {
      const { error: err } = await supabase.from("expenses").update(payload).eq("id", expense.id);
      error = err;
    } else {
      const { data: insertData, error: err } = await supabase.from("expenses").insert(payload).select().single();
      error = err;
      if (insertData) savedId = insertData.id;
    }

    if (error) {
      toast.error(error.message);
    } else if (savedId) {
      // Sync custom fields
      const cfUpserts = customFields.filter(f => customValues[f.id] !== undefined).map(f => ({
         expense_id: savedId!,
         custom_field_id: f.id,
         value: customValues[f.id]
      }));
      if (cfUpserts.length > 0) {
        await supabase.from('expense_custom_values').delete().eq('expense_id', savedId);
        await supabase.from('expense_custom_values').insert(cfUpserts);
      }

      toast.success(expense ? "Expense updated" : "Expense submitted");
      onSaved();
      onOpenChange(false);
    }
    
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{expense ? "Edit Expense" : "Submit Expense"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="expense_type">Expense Type <span className="text-destructive">*</span></Label>
              <Controller
                control={form.control}
                name="expense_type_id"
                render={({ field }) => (
                  <Select key={expenseTypes.length} value={field.value} onValueChange={(val) => handleTypeChange(val || "")}>
                    <SelectTrigger id="expense_type">
                      <SelectValue placeholder="Select type">
                        {expenseTypes.find(t => t.id === field.value)?.expense_name || "Select type"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {expenseTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.expense_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.expense_type_id && (
                <p className="text-xs text-destructive">{form.formState.errors.expense_type_id.message}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Date <span className="text-destructive">*</span></Label>
              <Controller
                control={form.control}
                name="expense_date"
                render={({ field }) => (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        />
                      }
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
            </div>

            {selectedType?.allowance_type === "TRAVELLING" && selectedType.is_per_km === "USER" && (
              <div className="grid gap-2">
                <Label>Travel KM</Label>
                <Input
                  type="number"
                  step="0.1"
                  {...form.register("travel_km", { valueAsNumber: true })}
                  onChange={handleKmChange}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>Amount (₹) <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                step="0.01"
                {...form.register("amount", { valueAsNumber: true })}
                disabled={!selectedType || (!isAdmin && ((!selectedType.amount_changeable && selectedType.is_per_km === "NO") || selectedType.is_per_km !== "NO"))}
                className={!selectedType || (!isAdmin && ((!selectedType.amount_changeable && selectedType.is_per_km === "NO") || selectedType.is_per_km !== "NO")) ? "bg-muted cursor-not-allowed" : ""}
              />
              {form.formState.errors.amount && (
                <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Remarks</Label>
              <Textarea
                placeholder="Optional notes..."
                {...form.register("remarks")}
              />
            </div>

            {selectedType && (
              <div className="grid gap-2">
                <Label>Proof Attachment {selectedType.proof_required && <span className="text-destructive">*</span>}</Label>
                <div className="flex items-center gap-4">
                  <Input 
                    type="file" 
                    accept="image/*,.pdf"
                    onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                    className="flex-1 text-sm file:text-sm file:font-medium"
                  />
                </div>
                {expense?.proof_file && !proofFile && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Current proof file is attached. Uploading a new one will replace it.
                  </p>
                )}
              </div>
            )}

            {customFields.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-border mt-2">
                <h4 className="text-sm font-medium text-foreground pb-2">Custom Fields</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {customFields.map((field) => (
                    <div key={field.id} className="grid gap-2">
                      <Label className="text-muted-foreground capitalize">{field.field_name}</Label>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit Expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, UploadCloud, X, Receipt } from "lucide-react";
import { FormPageShell } from "@/components/shared";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Expense, ExpenseType, Profile, CustomField } from "@/types";
import { cn } from "@/lib/utils";
import { CustomFieldInput } from "@/components/ui/custom-field-input";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from "@/lib/custom-fields";

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
  odometer_start: z.number().min(0).optional(),
  odometer_end: z.number().min(0).optional(),
  remarks: z.string().optional(),
  proof_file: z.any().optional(),
});

type FormValues = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
  expense?: Expense | null;
  onSaved: () => void;
}

export function ExpenseForm({ open, onOpenChange, asPage = false, expense, onSaved }: ExpenseFormProps) {
  const { user, accountId, profile, accountRole } = useAuth();
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
        odometer_start: expense.odometer_start ?? 0,
        odometer_end: expense.odometer_end ?? 0,
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
        odometer_start: 0,
        odometer_end: 0,
        remarks: "",
      });
      setSelectedType(null);
      setProofFile(null);
    }
  }, [open, expense, expenseTypes, form]);

  async function loadExpenseTypes() {
    if (!accountId) return;
    await ensureDefaultSectionsAndFields(accountId, "expense", user?.id, supabase);
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
      
      // Resolve Rate Tier (keyed on the employee's role)
      if (type.enable_rate_tiers && profile?.employee_role_id) {
        const { data: tier } = await supabase
          .from('expense_rate_tiers')
          .select('*')
          .eq('expense_type_id', type.id)
          .eq('employee_role_id', profile.employee_role_id)
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
      form.setValue("odometer_start", 0);
      form.setValue("odometer_end", 0);
    }
  };

  // Manual odometer entry: distance = End - Start, amount = distance x admin rate.
  const recomputeFromOdometer = (start: number, end: number) => {
    const km = end > start ? end - start : 0;
    form.setValue("travel_km", km);
    if (selectedType && selectedType.is_per_km !== "NO") {
      const rate = resolvedRate !== null ? resolvedRate : selectedType.rate_per_km;
      form.setValue("amount", km * rate);
    }
  };
  const handleOdoStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const start = parseFloat(e.target.value) || 0;
    form.setValue("odometer_start", start);
    recomputeFromOdometer(start, form.getValues("odometer_end") || 0);
  };
  const handleOdoEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const end = parseFloat(e.target.value) || 0;
    form.setValue("odometer_end", end);
    recomputeFromOdometer(form.getValues("odometer_start") || 0, end);
  };

  const onSubmit = async (data: FormValues) => {
    if (!profile) return;
    
    if (selectedType?.proof_required && !proofFile && !expense?.proof_file) {
      toast.error("Proof file is required for this expense type");
      return;
    }

    // Travelling with manual odometer entry: End must exceed Start.
    if (selectedType?.allowance_type === "TRAVELLING" && selectedType.is_per_km !== "NO") {
      const s = data.odometer_start || 0;
      const en = data.odometer_end || 0;
      if (!(en > s)) {
        toast.error("Enter valid odometer readings — End must be greater than Start.");
        return;
      }
    }

    const cfError = validateRequiredCustomFields(customFields, customValues, {
      expense_type: data.expense_type_id,
      amount: data.amount,
      expense_date: data.expense_date,
    });
    if (cfError) {
      toast.error(cfError);
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
      odometer_start: selectedType?.allowance_type === "TRAVELLING" ? (data.odometer_start || null) : null,
      odometer_end: selectedType?.allowance_type === "TRAVELLING" ? (data.odometer_end || null) : null,
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

  const formContent = (
    <>
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4 pr-6">
            <h2 className="text-xl font-light text-foreground">{expense ? "Edit Expense" : "Submit Expense"}</h2>
          </div>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="expense_type">Expense Type <span className="text-destructive">*</span></Label>
              <Controller
                control={form.control}
                name="expense_type_id"
                render={({ field }) => (
                  <Select key={expenseTypes.length} value={field.value || ""} onValueChange={(val) => handleTypeChange(val || "")}>
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

            {selectedType?.allowance_type === "TRAVELLING" && selectedType.is_per_km !== "NO" && (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Odometer Start (KM)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Start reading"
                      {...form.register("odometer_start", { valueAsNumber: true })}
                      onChange={handleOdoStartChange}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Odometer End (KM)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="End reading"
                      {...form.register("odometer_end", { valueAsNumber: true })}
                      onChange={handleOdoEndChange}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Distance: {form.watch("travel_km") || 0} KM × ₹{resolvedRate !== null ? resolvedRate : selectedType.rate_per_km}/KM
                  {" = ₹"}{form.watch("amount") || 0}
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-border mt-2">
              <CustomFieldsSectionRenderer
                accountId={accountId}
                moduleName="expense"
                customFields={customFields}
                customValues={customValues}
                onChange={(fieldId, val) =>
                  setCustomValues((prev) => ({ ...prev, [fieldId]: val }))
                }
                formData={{
                  expense_date: form.watch("expense_date") ? format(form.watch("expense_date"), "yyyy-MM-dd") : "",
                  amount: form.watch("amount") ?? "",
                }}
                onFormDataChange={(key, val) => {
                  if (key === "expense_date" && val) {
                    form.setValue("expense_date", new Date(val));
                  }
                  if (key === "amount") {
                    form.setValue("amount", Number(val) || 0);
                  }
                }}
                renderCustomSystemField={(field) => {
                  if (field.system_key === "amount") {
                    const isDisabled = !selectedType || (!isAdmin && ((!selectedType.amount_changeable && selectedType.is_per_km === "NO") || selectedType.is_per_km !== "NO"));
                    return (
                      <Input
                        type="number"
                        step="0.01"
                        value={form.watch("amount") ?? ""}
                        onChange={(e) => form.setValue("amount", e.target.valueAsNumber || 0)}
                        disabled={isDisabled}
                        className={isDisabled ? "bg-muted cursor-not-allowed" : ""}
                      />
                    );
                  }
                  // Other predefined fields (expense_date) fall through to the
                  // default input. null would hide them.
                  return undefined;
                }}
              />
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

          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit Expense"}
            </Button>
          </div>
    </>
  );

  if (asPage) {
    return (
      <FormPageShell
        icon={Receipt}
        title={expense ? "Edit Expense" : "Submit New Expense"}
        subtitle={expense ? "Update the expense details below." : "Submit an expense claim with receipts and remarks."}
        onBack={() => onOpenChange(false)}
      >
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {formContent}
        </form>
      </FormPageShell>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {formContent}
        </form>
      </DialogContent>
    </Dialog>
  );
}

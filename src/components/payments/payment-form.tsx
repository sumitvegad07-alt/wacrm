'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Controller } from 'react-hook-form';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, ArrowLeft, UploadCloud, X } from 'lucide-react';
import { CustomFieldsSectionRenderer } from '@/components/custom-fields/custom-fields-section-renderer';
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { logModuleActivity } from '@/lib/activities';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { cn } from '@/lib/utils';

// Zod and react-hook-form imports
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm as useHookForm } from 'react-hook-form';

interface PaymentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
  onSaved: () => void;
  contactId?: string | null;
  siteVisitId?: string | null;
  source?: 'visit' | 'customer' | 'admin';
}

const paymentSchema = z.object({
  contact_id: z.string().min(1, 'Customer is required'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  payment_type: z.string().min(1, 'Payment type is required'),
  payment_date: z.string().min(1, 'Payment date is required'),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface FinancialSnapshot {
  outstanding: number;
  credit_limit: number;
  available_credit: number;
  overdue_days: number;
}

export function PaymentForm({
  open,
  onOpenChange,
  asPage = false,
  onSaved,
  contactId: initialContactId,
  siteVisitId,
  source = 'admin',
}: PaymentFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency, hasPermission, user } = useAuth();
  
  const [contacts, setContacts] = useState<{ value: string; label: string }[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [proofFile, setProofFile] = useState<File | null>(null);
  
  const [financials, setFinancials] = useState<FinancialSnapshot | null>(null);
  const [financialsLoading, setFinancialsLoading] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useHookForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      contact_id: initialContactId || '',
      amount: 0,
      payment_type: '',
      payment_date: new Date().toISOString().split('T')[0],
      reference_number: '',
      notes: '',
    },
  });

  const selectedContactId = watch('contact_id');

  useEffect(() => {
    if (!open || !accountId) return;

    let alive = true;
    const loadDependencies = async () => {
      setLoading(true);
      const [
        { data: contactsData },
        { data: paymentTypesData },
        { data: fieldsData },
      ] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, company, name')
          .eq('account_id', accountId)
          .order('company', { ascending: true }),
        supabase
          .from('payment_types')
          .select('id, name')
          .eq('account_id', accountId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('custom_fields')
          .select('*')
          .eq('account_id', accountId)
          .eq('module_name', 'payment')
          .eq('is_active', true),
      ]);

      if (!alive) return;

      if (contactsData) {
        setContacts(
          contactsData.map((c) => ({
            value: c.id,
            label: c.company || c.name || 'Unknown',
          }))
        );
      }

      if (paymentTypesData) {
        setPaymentTypes(paymentTypesData);
      }

      if (fieldsData) {
        await ensureDefaultSectionsAndFields(accountId, 'payment', undefined, supabase);
        setCustomFields(fieldsData);
      }

      setLoading(false);
    };

    loadDependencies();
    return () => { alive = false; };
  }, [open, accountId, supabase]);

  useEffect(() => {
    if (!selectedContactId || !accountId) {
      setFinancials(null);
      return;
    }

    let alive = true;
    const fetchFinancials = async () => {
      setFinancialsLoading(true);
      
      // Attempt to calculate financial snapshot
      // Outstanding = sum of approved order totals - sum of approved payment COALESCE(verified_amount, amount) + opening_balance
      const [{ data: contactData }, { data: ordersData }, { data: paymentsData }] = await Promise.all([
        supabase.from('contacts').select('credit_limit, opening_balance').eq('id', selectedContactId).single(),
        supabase.from('orders').select('total_amount').eq('contact_id', selectedContactId).eq('status', 'Approved'),
        supabase.from('payments').select('amount, verified_amount').eq('contact_id', selectedContactId).eq('status', 'Approved'),
      ]);

      if (!alive) return;

      const openingBalance = contactData?.opening_balance || 0;
      const creditLimit = contactData?.credit_limit || 0;
      
      const ordersTotal = (ordersData || []).reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
      const paymentsTotal = (paymentsData || []).reduce((sum, p) => sum + Number(p.verified_amount ?? p.amount ?? 0), 0);
      
      const outstanding = ordersTotal - paymentsTotal + openingBalance;
      const availableCredit = creditLimit - outstanding;
      
      setFinancials({
        outstanding,
        credit_limit: creditLimit,
        available_credit: availableCredit,
        overdue_days: 0, // Placeholder
      });
      setFinancialsLoading(false);
    };

    fetchFinancials();
    return () => { alive = false; };
  }, [selectedContactId, accountId, supabase]);

  const onSubmit = async (data: PaymentFormData) => {
    if (!hasPermission(PERMISSIONS.PAYMENTS.CREATE)) {
      toast.error('You do not have permission to add payments.');
      return;
    }

    const valErr = validateRequiredCustomFields(customFields, customValues);
    if (valErr) {
      toast.error(`Required custom field missing: ${valErr}`);
      return;
    }

    setSaving(true);
    try {
      // Proof of payment lives in the private `payment_attachments` bucket. We store the
      // object path (not a URL) and mint short-lived signed URLs on read — cheque images
      // and bank receipts must never be reachable by guessing a public URL.
      let proofPath: string | null = null;

      if (proofFile) {
        const fileExt = proofFile.name.split('.').pop();
        const filePath = `${accountId}/${user?.id}/${crypto.randomUUID()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('payment_attachments')
          .upload(filePath, proofFile);

        if (uploadError) {
          console.error("Storage upload error", uploadError);
          // The payment itself is the record of record — never lose it over a failed upload.
          toast.warning("Payment saved, but the proof image could not be uploaded. You can attach it again from the payment detail page.");
        } else {
          proofPath = filePath;
        }
      }

      // 1. Fetch account settings for approval_required
      const { data: accountData } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', accountId!)
        .single();
        
      const approvalRequired = accountData?.settings?.payment_settings?.approval_required ?? true;
      const status = approvalRequired ? 'Pending' : 'Approved';

      // 2. Insert Payment
      const selectedType = paymentTypes.find(t => t.id === data.payment_type);
      
      const { data: paymentResult, error } = await supabase.from('payments').insert({
        id: idempotencyKey.current,
        account_id: accountId!,
        user_id: user!.id,
        contact_id: data.contact_id,
        amount: data.amount,
        payment_type_id: selectedType?.id,
        payment_type: selectedType?.name || 'Unknown',
        payment_date: data.payment_date,
        reference_number: data.reference_number || null,
        notes: data.notes || null,
        source: source,
        site_visit_id: siteVisitId || null,
        status: status,
      }).select('id').single();

      if (error) {
        if (error.code === '23505') {
          // Duplicate key violation - our previous attempt succeeded but timed out on the client!
          // We can safely treat this as a success and continue with the cleanup.
          toast.success("Payment saved successfully (recovered from network timeout).");
        } else {
          toast.error(`Failed to save payment: ${error.message}`);
          setSaving(false);
          return;
        }
      }
      
      const newPaymentId = paymentResult?.id || idempotencyKey.current;

      // 3. Link the uploaded proof to the payment
      if (proofPath) {
        const { error: attachErr } = await supabase.from('payment_attachments').insert({
          payment_id: newPaymentId,
          user_id: user!.id,
          file_name: proofFile!.name,
          file_url: proofPath,
          file_size: proofFile!.size,
          content_type: proofFile!.type,
        });
        if (attachErr) {
          console.error('Attachment link error', attachErr);
          toast.warning('Payment saved, but the proof image could not be linked to it.');
        }
      }

      // 4. Save Custom Fields
      const cvInserts = Object.entries(customValues)
        .filter(([_, val]) => val !== undefined && val !== '')
        .map(([cfId, val]) => ({
          payment_id: newPaymentId,
          custom_field_id: cfId,
          value: val,
        }));
        
      if (cvInserts.length > 0) {
        await supabase.from('payment_custom_values').insert(cvInserts);
      }

      // 4. Log Activity
      await logModuleActivity(supabase, {
        moduleName: 'payment',
        recordId: newPaymentId,
        action: 'created',
        message: `Payment created via ${source}.`,
      });

      // 5. Cleanup
      toast.success('Payment saved successfully!');
      idempotencyKey.current = crypto.randomUUID();
      reset();
      setCustomValues({});
      setProofFile(null);
      setFinancials(null);
      onSaved();
      if (!asPage) onOpenChange(false);

    } catch (err: any) {
      toast.error(`Exception: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: defaultCurrency || 'INR',
    }).format(val);
  };

  const content = loading ? (
    <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  ) : (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-6", !asPage && "max-h-[80vh] overflow-y-auto px-4 pb-4")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Customer <span className="text-red-500">*</span></Label>
          <Controller
            control={control}
            name="contact_id"
            render={({ field }) => (
              <SearchableSelect
                options={contacts}
                value={field.value}
                onChange={field.onChange}
                placeholder="Select a customer..."
              />
            )}
          />
          {errors.contact_id && <p className="text-sm text-destructive">{errors.contact_id.message}</p>}
        </div>
        
        <div className="space-y-2">
          <Label>Amount <span className="text-red-500">*</span></Label>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <Input
                type="number"
                step="0.01"
                min="0"
                value={field.value || ''}
                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            )}
          />
          {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
        </div>

        <div className="space-y-2">
          <Label>Payment Type <span className="text-red-500">*</span></Label>
          <Controller
            control={control}
            name="payment_type"
            render={({ field }) => (
              <SearchableSelect
                options={paymentTypes.map(pt => ({ value: pt.id, label: pt.name }))}
                value={field.value}
                onChange={field.onChange}
                placeholder="Select payment type..."
              />
            )}
          />
          {errors.payment_type && <p className="text-sm text-destructive">{errors.payment_type.message}</p>}
        </div>

        <div className="space-y-2">
          <Label>Payment Date <span className="text-red-500">*</span></Label>
          <Controller
            control={control}
            name="payment_date"
            render={({ field }) => (
              <Input
                type="date"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          {errors.payment_date && <p className="text-sm text-destructive">{errors.payment_date.message}</p>}
        </div>

        <div className="space-y-2">
          <Label>Reference Number</Label>
          <Controller
            control={control}
            name="reference_number"
            render={({ field }) => (
              <Input value={field.value} onChange={field.onChange} placeholder="Cheque #, UTR, etc." />
            )}
          />
        </div>
        
        <div className="space-y-2 md:col-span-2">
          <Label>Notes</Label>
          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <Input value={field.value} onChange={field.onChange} placeholder="Optional notes" />
            )}
          />
        </div>
        
        <div className="space-y-2 md:col-span-2">
          <Label>Attachment (Optional)</Label>
          {proofFile ? (
            <div className="flex items-center justify-between p-3 border rounded-md">
              <span className="text-sm truncate mr-4">{proofFile.name}</span>
              <Button type="button" variant="ghost" size="icon" onClick={() => setProofFile(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-bray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-600">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <UploadCloud className="w-8 h-8 mb-4 text-gray-500 dark:text-gray-400" />
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                </div>
                <input type="file" className="hidden" onChange={(e) => {
                  if (e.target.files?.[0]) setProofFile(e.target.files[0]);
                }} />
              </label>
            </div>
          )}
        </div>
      </div>

      {financials && !financialsLoading && (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Outstanding</p>
            <p className="text-lg font-bold">{formatCurrency(financials.outstanding)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Credit Limit</p>
            <p className="text-lg font-bold">{formatCurrency(financials.credit_limit)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Available Credit</p>
            <p className="text-lg font-bold">{formatCurrency(financials.available_credit)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Overdue Days</p>
            <p className="text-lg font-bold">{financials.overdue_days}</p>
          </div>
        </div>
      )}

      {customFields.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="text-sm font-semibold mb-3">Additional Details</h3>
          <CustomFieldsSectionRenderer accountId={accountId} moduleName="payment" customFields={customFields}
            customValues={customValues}
            onChange={(fieldId, val) => setCustomValues((prev) => ({ ...prev, [fieldId]: val }))}
          />
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t mt-6">
        {!asPage && (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Payment
        </Button>
      </div>
    </form>
  );

  if (asPage) {
    return (
      <div className="w-full space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}><ArrowLeft className="h-5 w-5" /></Button>
          <h1 className="text-2xl font-bold">New Payment</h1>
        </div>
        <div className="bg-card border rounded-xl shadow-sm p-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Payment</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}



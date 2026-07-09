'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { ProductDetailsTable, type PartialQuotationItem } from './product-details-table';
import { TermsEditor } from './terms-editor';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
import { logQuotationActivity } from '@/lib/quotations';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface QuotationFormProps {
  initialData?: any; // Existing quotation data if editing
  quotationId?: string;
  cloneId?: string;
  versionId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (savedId?: string) => void;
}

export function QuotationForm({ 
  initialData, 
  quotationId,
  cloneId,
  versionId,
  open,
  onOpenChange,
  onSaved
}: QuotationFormProps) {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [targetType, setTargetType] = useState<'contact' | 'lead'>('contact');
  const [contacts, setContacts] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);

  // Form State
  const [contactId, setContactId] = useState<string>('');
  const [leadId, setLeadId] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [validUntil, setValidUntil] = useState<string>('');
  const [status, setStatus] = useState('Pending');
  const [items, setItems] = useState<PartialQuotationItem[]>([]);
  const [terms, setTerms] = useState<string>('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  
  // Track parent details for drafts
  const [draftVersion, setDraftVersion] = useState<number>(1);
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [draftParentNumber, setDraftParentNumber] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      
      // Fetch dependencies
      const [
        { data: contactsData },
        { data: leadsData },
        { data: productsData },
        { data: templatesData },
        { data: fieldsData }
      ] = await Promise.all([
        supabase.from('contacts').select('id, name').order('name'),
        supabase.from('leads').select('id, title').order('title'),
        supabase.from('products').select('id, name, sku, price').eq('active', true).order('name'),
        supabase.from('quotation_terms_templates').select('*').order('title'),
        supabase.from('custom_fields').select('*').eq('module_name', 'quotation').order('created_at')
      ]);

      setContacts(contactsData || []);
      setLeads(leadsData || []);
      setProducts(productsData || []);
      setTemplates(templatesData || []);
      setCustomFields(fieldsData || []);

      // If editing, load initial data
      if (initialData) {
        setContactId(initialData.contact_id || '');
        setDate(initialData.date || new Date().toISOString().split('T')[0]);
        setValidUntil(initialData.valid_until || '');
        setStatus(initialData.status || 'Draft');
        setTerms(initialData.terms_conditions || '');

        // Fetch items
        const { data: itemsData } = await supabase
          .from('quotation_items')
          .select('*')
          .eq('quotation_id', initialData.id)
          .order('position');
        
        if (itemsData) {
          setItems(itemsData);
        }

        // Fetch custom values
        const { data: cvData } = await supabase
          .from('quotation_custom_values')
          .select('custom_field_id, value')
          .eq('quotation_id', initialData.id);
        
        if (cvData) {
          const cvMap: Record<string, string> = {};
          cvData.forEach(cv => {
            cvMap[cv.custom_field_id] = cv.value;
          });
          setCustomValues(cvMap);
        }
      } else if (cloneId || versionId) {
        const sourceId = cloneId || versionId;
        const { data: sourceData } = await supabase.from('quotations').select('*').eq('id', sourceId).single();
        
        if (sourceData) {
          if (sourceData.lead_id) {
            setTargetType('lead');
            setLeadId(sourceData.lead_id);
          } else {
            setTargetType('contact');
            setContactId(sourceData.contact_id || '');
          }
          setDate(new Date().toISOString().split('T')[0]); // Today for cloned/versioned
          setValidUntil(sourceData.valid_until || '');
          setStatus('Draft');
          setTerms(sourceData.terms_conditions || '');

          if (versionId) {
            setDraftParentId(sourceData.id);
            setDraftVersion((sourceData.version || 1) + 1);
            setDraftParentNumber(sourceData.quotation_number);
          }

          // Fetch items
          const { data: itemsData } = await supabase
            .from('quotation_items')
            .select('*')
            .eq('quotation_id', sourceData.id)
            .order('position');
          
          if (itemsData) {
            // Strip IDs so they create new rows on save
            setItems(itemsData.map(item => ({ ...item, id: undefined, quotation_id: undefined })));
          }

          // Fetch custom values
          const { data: cvData } = await supabase
            .from('quotation_custom_values')
            .select('custom_field_id, value')
            .eq('quotation_id', sourceData.id);
          
          if (cvData) {
            const cvMap: Record<string, string> = {};
            cvData.forEach(cv => {
              cvMap[cv.custom_field_id] = cv.value;
            });
            setCustomValues(cvMap);
          }
        }
      } else if (quotationId) {
        const { data: sourceData } = await supabase.from('quotations').select('*').eq('id', quotationId).single();
        if (sourceData) {
          if (sourceData.lead_id) {
            setTargetType('lead');
            setLeadId(sourceData.lead_id);
          } else {
            setTargetType('contact');
            setContactId(sourceData.contact_id || '');
          }
          setDate(sourceData.date || new Date().toISOString().split('T')[0]);
          setValidUntil(sourceData.valid_until || '');
          setStatus(sourceData.status || 'Draft');
          setTerms(sourceData.terms_conditions || '');

          const { data: itemsData } = await supabase
            .from('quotation_items')
            .select('*')
            .eq('quotation_id', sourceData.id)
            .order('position');
          
          if (itemsData) {
            setItems(itemsData);
          }

          const { data: cvData } = await supabase
            .from('quotation_custom_values')
            .select('custom_field_id, value')
            .eq('quotation_id', sourceData.id);
          
          if (cvData) {
            const cvMap: Record<string, string> = {};
            cvData.forEach(cv => {
              cvMap[cv.custom_field_id] = cv.value;
            });
            setCustomValues(cvMap);
          }
        }
      } else {
        // Automatically load default template if it exists
        const defaultTemplate = (templatesData || []).find((t: any) => t.is_default);
        if (defaultTemplate) setTerms(defaultTemplate.content);
      }

      setLoading(false);
    }
    
    fetchData();
  }, [initialData, supabase]);

  const handleSave = async () => {
    if (targetType === 'contact' && !contactId) {
      toast.error('Please select a contact');
      return;
    }
    if (targetType === 'lead' && !leadId) {
      toast.error('Please select a lead');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one product to the quotation');
      return;
    }

    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error('Not authenticated');
      setSaving(false);
      return;
    }

    const { data: accountData } = await supabase.from('profiles').select('account_id').eq('user_id', userData.user.id).single();
    if (!accountData) {
      toast.error('No account found');
      setSaving(false);
      return;
    }

    const subTotal = items.reduce((sum, item) => sum + (Number(item.sub_total) || 0), 0);
    const taxTotal = items.reduce((sum, item) => sum + (Number(item.tax_amount) || 0), 0);
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

    const quotationPayload = {
      account_id: accountData.account_id,
      user_id: userData.user.id,
      contact_id: targetType === 'contact' ? contactId : null,
      lead_id: targetType === 'lead' ? leadId : null,
      date,
      valid_until: validUntil || null,
      status,
      terms_conditions: terms,
      sub_total: subTotal,
      tax_total: taxTotal,
      total_amount: totalAmount,
    } as any;

    if (!initialData) {
      if (draftParentId) {
        quotationPayload.parent_id = draftParentId;
        quotationPayload.version = draftVersion;
        // Strip out existing suffix if present, e.g. QT-034-1 -> QT-034
        let baseNum = draftParentNumber;
        if (draftParentNumber) {
          const parts = draftParentNumber.split('-');
          if (parts.length > 2) {
            baseNum = parts.slice(0, 2).join('-');
          }
        }
        quotationPayload.quotation_number = `${baseNum}-${draftVersion}`;
      }
    }

    let savedQuotationId = quotationId;

    if (quotationId) {
      // Update existing
      const { error } = await supabase
        .from('quotations')
        .update(quotationPayload)
        .eq('id', quotationId);
        
      if (error) {
        toast.error('Failed to update quotation');
        setSaving(false);
        return;
      }
    } else {
      // Create new
      const { data: newQ, error: insertError } = await supabase
        .from('quotations')
        .insert([quotationPayload])
        .select('id')
        .single();
        
      if (insertError || !newQ) {
        toast.error(`Failed to create quotation: ${insertError?.message || 'Unknown error'}`);
        setSaving(false);
        return;
      }
      savedQuotationId = newQ.id;
    }

    if (savedQuotationId) {
      // Sync Items
      // 1. Delete old items if updating
      if (quotationId) {
        await supabase.from('quotation_items').delete().eq('quotation_id', savedQuotationId);
      }
      // 2. Insert new items
      const itemsPayload = items.map((item, index) => ({
        quotation_id: savedQuotationId,
        product_id: item.product_id || null,
        product_name: item.product_name,
        unit: item.unit,
        quantity: item.quantity,
        price: item.price,
        tax_rate: item.tax_rate,
        tax_amount: item.tax_amount,
        sub_total: item.sub_total,
        total: item.total,
        position: index,
      }));
      await supabase.from('quotation_items').insert(itemsPayload);

      // Sync Custom Fields
      if (customFields.length > 0) {
        if (quotationId) {
          await supabase.from('quotation_custom_values').delete().eq('quotation_id', savedQuotationId);
        }
        
        const cvPayloads = customFields
          .filter(cf => customValues[cf.id] !== undefined && customValues[cf.id] !== '')
          .map(cf => ({
            quotation_id: savedQuotationId,
            custom_field_id: cf.id,
            value: customValues[cf.id]
          }));
          
        if (cvPayloads.length > 0) {
          await supabase.from('quotation_custom_values').insert(cvPayloads);
        }
      }

      setSaving(false);
      toast.success(initialData ? 'Quotation updated' : 'Quotation created');
      
      if (!initialData && draftParentId) {
        // Update the parent so it hides from the main table
        try {
          await supabase.from('quotations').update({ is_latest_version: false }).eq('id', draftParentId);
        } catch(e) { console.error('Failed to update is_latest_version', e); }

        // Log the generation of the new version on the parent and the child!
        await logQuotationActivity(supabase, draftParentId, 'versioned', { 
          new_version: draftVersion, 
          new_id: savedQuotationId,
          new_number: quotationPayload.quotation_number,
          original_number: draftParentNumber
        });
        await logQuotationActivity(supabase, savedQuotationId, 'created_as_version', { 
          original_id: draftParentId,
          new_number: quotationPayload.quotation_number,
          original_number: draftParentNumber
        });
      } else {
        await logQuotationActivity(
          supabase, 
          savedQuotationId, 
          quotationId ? 'updated' : 'created'
        );
      }

      // Instead of redirecting from inside the form, let the parent handle it
      onSaved(savedQuotationId);
      onOpenChange(false);
    } else {
      toast.error('Failed to sync quotation items');
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground text-xl">
            {quotationId ? 'Edit Quotation' : 'Create Quotation'}
            {initialData?.quotation_number && (
              <span className="ml-2 text-sm text-muted-foreground font-normal">({initialData.quotation_number})</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {quotationId ? "Update the quotation details below." : "Fill in the details to create a new quotation."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-8 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          <Label className="text-muted-foreground flex items-center justify-between">
            Quotation For <span className="text-red-400">*</span>
            <div className="flex items-center space-x-2 bg-muted rounded-md p-0.5">
              <button
                type="button"
                className={`px-2 py-1 text-xs rounded-sm transition-colors ${targetType === 'contact' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTargetType('contact')}
              >
                Contact
              </button>
              <button
                type="button"
                className={`px-2 py-1 text-xs rounded-sm transition-colors ${targetType === 'lead' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTargetType('lead')}
              >
                Lead
              </button>
            </div>
          </Label>
          {targetType === 'contact' ? (
            <SearchableSelect
              value={contactId}
              onChange={setContactId}
              placeholder="Select a contact"
              searchPlaceholder="Search contacts..."
              emptyMessage="No contacts found."
              options={contacts.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          ) : (
            <SearchableSelect
              value={leadId}
              onChange={setLeadId}
              placeholder="Select a lead"
              searchPlaceholder="Search leads..."
              emptyMessage="No leads found."
              options={leads.map((l) => ({
                value: l.id,
                label: l.title,
              }))}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">Date <span className="text-red-500">*</span></Label>
          <Input 
            id="date" 
            type="date" 
            className="bg-background"
            value={date} 
            onChange={e => setDate(e.target.value)} 
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="valid_until">Valid Until</Label>
          <Input 
            id="valid_until" 
            type="date" 
            className="bg-background"
            value={validUntil} 
            onChange={e => setValidUntil(e.target.value)} 
          />
        </div>

      </div>


      {customFields.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="text-lg font-medium text-foreground">Custom Fields</h3>
          <div className="bg-muted/20 p-4 rounded-lg border border-border space-y-4">
            {customFields.map((field) => (
              <div key={field.id} className="space-y-2">
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

      <div className="pt-4 border-t border-border">
        <ProductDetailsTable 
          items={items} 
          onChange={setItems} 
          products={products} 
        />
      </div>

      <div className="pt-4 border-t border-border">
        <h3 className="text-lg font-medium text-foreground mb-4">Terms & Conditions</h3>
        <TermsEditor 
          value={terms} 
          onChange={setTerms} 
          templates={templates} 
          onTemplateAdded={(newT) => setTemplates(prev => [...prev, newT])}
        />
      </div>
          </div>
        )}
        
        {!loading && (
          <DialogFooter className="bg-popover border-border sm:justify-between items-center w-full mt-6 flex-row gap-4">
            <div className="flex-1"></div>
            <div className="flex gap-2 justify-end shrink-0">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {versionId ? 'SAVE NEW VERSION' : quotationId ? 'Update Quotation' : 'Create Quotation'}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

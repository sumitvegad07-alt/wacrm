'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, CustomField } from '@/types';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
import {
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
  /** Open an existing contact's detail view — used by the duplicate
   *  notice to jump to the contact that already owns this number. */
  onViewExisting?: (contactId: string) => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const isEdit = !!contact;

  const [name, setName] = useState('');          // contact person
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');    // company / firm name (primary)
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [country, setCountry] = useState('');
  const [pincode, setPincode] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [saving, setSaving] = useState(false);

  // Duplicate-phone detection for NEW contacts. `exact` (same digits)
  // hard-blocks the save; a fuzzy trunk-variant match only warns. The
  // DB unique index (migration 022) is the real backstop — this is the
  // friendly heads-up before we get there.
  const [dupMatch, setDupMatch] = useState<
    { contact: ExistingContact; exact: boolean } | null
  >(null);
  const [checkingDup, setCheckingDup] = useState(false);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Order-hierarchy config drives the Customer Level field's visibility.
  const [hierarchy, setHierarchy] = useState<{ enabled: boolean; levels: { position: number; name: string }[] }>({ enabled: false, levels: [] });
  const [hierarchyLevel, setHierarchyLevel] = useState<number | null>(null);

  useEffect(() => {
    if (open && accountId) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setAddress(contact?.address ?? '');
      setArea(contact?.area ?? '');
      setCity(contact?.city ?? '');
      setStateField(contact?.state ?? '');
      setCountry(contact?.country ?? '');
      setPincode(contact?.pincode ?? '');
      setLatitude(contact?.latitude != null ? String(contact.latitude) : '');
      setLongitude(contact?.longitude != null ? String(contact.longitude) : '');
      setHierarchyLevel(contact?.hierarchy_level ?? null);
      setDupMatch(null);
      fetchCustomFields();
      fetchHierarchyConfig();
    }
  }, [open, contact, accountId]);

  async function fetchHierarchyConfig() {
    if (!accountId) return;
    const { data: acct } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
    const os = acct?.settings?.order_settings;
    setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? os.levels : [] });
  }

  // Look up an existing contact with this number (new contacts only).
  // Runs on blur so we don't query on every keystroke.
  async function checkDuplicate() {
    if (isEdit || !accountId) return;
    const value = phone.trim();
    if (!value) {
      setDupMatch(null);
      return;
    }
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(supabase, accountId, value);
      setDupMatch(
        existing
          ? { contact: existing, exact: isExactMatch(existing, value) }
          : null,
      );
    } finally {
      setCheckingDup(false);
    }
  }

  async function fetchCustomFields() {
    if (!accountId) return;
    const { data: fields } = await supabase
      .from('custom_fields')
      .select('*')
      .or('module_name.eq.contact,module_name.is.null')
      .order('field_name');
    
    if (fields) {
      setCustomFields(fields as CustomField[]);
      
      if (isEdit && contact?.id) {
        const { data: values } = await supabase
          .from('contact_custom_values')
          .select('*')
          .eq('contact_id', contact.id);
          
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
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Item 2 — required fields. Company name, contact person, phone, and
    // full address are mandatory; customer level is mandatory only when the
    // account has order hierarchy (secondary sales) enabled.
    if (!company.trim()) { toast.error('Company Name is required'); return; }
    if (!name.trim()) { toast.error('Contact Person is required'); return; }
    if (!phone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!address.trim()) { toast.error('Full Address is required'); return; }
    if (hierarchy.enabled && hierarchyLevel == null) {
      toast.error('Customer Level is required');
      return;
    }

    if (!isEdit && dupMatch?.exact) {
      toast.error('A customer with this phone number already exists');
      return;
    }

    if (!accountId || !user) {
      toast.error('Not authenticated');
      return;
    }

    setSaving(true);

    try {
      // Direct Supabase writes — the app's standard CRUD pattern (the old
      // useContacts/ApplicationProvider path was never wired up, and the
      // edit path did nothing at all).
      const fields = {
        name: name.trim() || null,          // contact person
        phone: phone.trim(),
        email: email.trim() || null,
        company: company.trim() || null,    // company / firm name
        address: address.trim() || null,
        area: area.trim() || null,
        city: city.trim() || null,
        state: stateField.trim() || null,
        country: country.trim() || null,
        pincode: pincode.trim() || null,
        latitude: latitude.trim() !== '' ? parseFloat(latitude) : null,
        longitude: longitude.trim() !== '' ? parseFloat(longitude) : null,
        hierarchy_level: hierarchy.enabled ? hierarchyLevel : null,
      };

      let contactId: string;

      if (isEdit && contact) {
        const { error } = await supabase.from('contacts').update(fields).eq('id', contact.id);
        if (error) throw error;
        contactId = contact.id;
      } else {
        const { data: created, error } = await supabase
          .from('contacts')
          .insert({ ...fields, account_id: accountId, user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        contactId = created.id;
      }

      // Custom values: replace-all.
      await supabase.from('contact_custom_values').delete().eq('contact_id', contactId);
      const cvRows = Object.entries(customValues)
        .filter(([, v]) => v && v.trim())
        .map(([fieldId, v]) => ({ contact_id: contactId, custom_field_id: fieldId, value: v }));
      if (cvRows.length > 0) {
        await supabase.from('contact_custom_values').insert(cvRows);
      }

      toast.success(isEdit ? 'Customer updated' : 'Customer created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save customer';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground text-xl">
            {isEdit ? 'Edit Customer' : 'Add Customer'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit
              ? 'Update the contact details below.'
              : 'Fill in the details to create a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Primary Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cf-company" className="text-muted-foreground">
                  Company Name <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="cf-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Distributors"
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cf-name" className="text-muted-foreground">
                  Contact Person <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="cf-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cf-phone" className="text-muted-foreground">
                  Phone <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="cf-phone"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (dupMatch) setDupMatch(null);
                  }}
                  onBlur={checkDuplicate}
                  placeholder="+1 234 567 8900"
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                {dupMatch ? (
                  <div
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                      dupMatch.exact
                        ? 'border-red-500/40 bg-red-500/10 text-red-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <div className="space-y-1">
                      <p>
                        {dupMatch.exact
                          ? 'A customer with this phone number already exists.'
                          : 'A customer with a very similar number already exists.'}
                      </p>
                      {onViewExisting && (
                        <button
                          type="button"
                          onClick={() => onViewExisting(dupMatch.contact.id)}
                          className="font-medium underline underline-offset-2 hover:no-underline"
                        >
                          View {dupMatch.contact.name || dupMatch.contact.phone}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Include country code, e.g. +1 for US
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cf-email" className="text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="cf-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@example.com"
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {hierarchy.enabled && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Customer Level <span className="text-red-400">*</span></Label>
                  <select
                    value={hierarchyLevel ?? ''}
                    onChange={(e) => setHierarchyLevel(e.target.value === '' ? null : parseInt(e.target.value))}
                    className="w-full h-9 rounded-md bg-muted border border-border text-foreground text-sm px-3"
                  >
                    <option value="">Not set</option>
                    {hierarchy.levels.map((lvl) => (
                      <option key={lvl.position} value={lvl.position}>
                        {lvl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Address & Location */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Address &amp; Location</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-muted-foreground">Full Address <span className="text-red-400">*</span></Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, landmark" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Area / Locality</Label>
                <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Andheri West" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">State</Label>
                <Input value={stateField} onChange={(e) => setStateField(e.target.value)} placeholder="State" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Pincode</Label>
                <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="Postal / PIN code" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Latitude</Label>
                <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="e.g. 19.1197" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Longitude</Label>
                <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="e.g. 72.8464" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground md:col-span-2">
                Coordinates are normally captured automatically on the mobile app during a visit. You can enter or adjust them here manually.
              </p>
            </div>
          </div>

          {customFields.length > 0 && (
            <div className="space-y-4 pt-2">
              <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Custom Fields</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || checkingDup || (!isEdit && !!dupMatch?.exact)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

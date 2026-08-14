'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { getCurrencySymbol } from '@/lib/currency';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, CustomField, Profile } from '@/types';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { TerritoryPicker } from '@/components/territories/territory-picker';
import { getTerritoryRows, getAccountTerritorySettings } from '@/lib/territories/api';
import { enabledLevels } from '@/lib/territories/settings';
import { DEFAULT_TERRITORY_SETTINGS } from '@/lib/territories/settings';
import type { Territory, TerritorySettings } from '@/lib/territories/types';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
import { CustomFieldsSectionRenderer } from '@/components/custom-fields/custom-fields-section-renderer';
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from '@/lib/custom-fields';
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
import { Loader2, AlertTriangle, ArrowLeft, Users } from 'lucide-react';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
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
  asPage = false,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const supabase = createClient();
  const { accountId, user, isModuleEnabled, hasPermission, defaultCurrency } = useAuth();
  // These three fields decide what a customer owes, so the database refuses to change
  // them without the matching permission. Mirror that here rather than letting someone
  // fill in a value that will be rejected on save.
  const currencySymbol = getCurrencySymbol(defaultCurrency);
  const isEditingExisting = Boolean(contact?.id);
  const canEditCreditTerms = !isEditingExisting || hasPermission(PERMISSIONS.CUSTOMERS.MANAGE_CREDIT);
  const canEditOpeningBalance = !isEditingExisting || hasPermission(PERMISSIONS.CUSTOMERS.EDIT_OPENING_BALANCE);
  const isEdit = !!contact;
  const territoryEnabled = isModuleEnabled('territory');

  const [name, setName] = useState('');          // contact person
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('+91');
  const [sameAsPhone, setSameAsPhone] = useState(false);
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
  
  // Payment Module Financials
  const [creditLimit, setCreditLimit] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  
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

  // Assignment Mode config
  const [assignmentMode, setAssignmentMode] = useState<'area' | 'direct'>('area');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');

  // Territory Master — the configured geography hierarchy that replaces the flat
  // country/state/city/area text fields (rendered dynamically, no hardcoded fields).
  const [territorySettings, setTerritorySettings] = useState<TerritorySettings>(DEFAULT_TERRITORY_SETTINGS);
  const [territoryRows, setTerritoryRows] = useState<Territory[]>([]);
  const [territoryId, setTerritoryId] = useState<string | null>(null);
  const [needsTerritoryReview, setNeedsTerritoryReview] = useState(false);

  // When Territory Master is enabled, the flat country/state/city/area system
  // fields are replaced by the Territory picker — hide them from the shared
  // custom-fields renderer (Customer form only; the shared renderer is untouched).
  const GEO_SYSTEM_KEYS = ['country', 'state', 'city', 'area'];
  const renderedCustomFields = useMemo(() => {
    let fields = territoryEnabled
      ? customFields.filter((f) => !(f.system_key && GEO_SYSTEM_KEYS.includes(f.system_key)))
      : customFields;

    if (assignmentMode === 'direct') {
      fields = [
        ...fields,
        {
          id: 'sys-employee_id',
          account_id: accountId || '',
          module_name: 'contact',
          name: 'Assign Employee',
          system_key: 'employee_id',
          field_type: 'select',
          is_system: true,
          is_active: true,
          is_required: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as unknown as CustomField
      ];
    }
    return fields;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFields, territoryEnabled, assignmentMode, accountId]);

  useEffect(() => {
    if (open && accountId) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setWhatsapp(contact?.whatsapp ?? '+91');
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
      setCreditLimit((contact as any)?.credit_limit != null ? String((contact as any).credit_limit) : '');
      setCreditDays((contact as any)?.credit_days != null ? String((contact as any).credit_days) : '');
      setOpeningBalance((contact as any)?.opening_balance != null ? String((contact as any).opening_balance) : '');
      setHierarchyLevel(contact?.hierarchy_level ?? null);
      setEmployeeId(contact?.employee_id ?? '');
      setDupMatch(null);
      setTerritoryId((contact as Contact & { territory_id?: string | null })?.territory_id ?? null);
      setNeedsTerritoryReview(!!(contact as Contact & { needs_territory_review?: boolean })?.needs_territory_review);
      fetchCustomFields();
      fetchSettingsConfig();
      if (territoryEnabled) fetchTerritoryData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, accountId]);

  async function fetchTerritoryData() {
    if (!accountId) return;
    try {
      const [s, rows] = await Promise.all([
        getAccountTerritorySettings(accountId),
        getTerritoryRows(accountId),
      ]);
      setTerritorySettings(s);
      setTerritoryRows(rows);
    } catch {
      /* territory data is optional enrichment; ignore load failure */
    }
  }

  async function fetchSettingsConfig() {
    if (!accountId) return;
    const [acctRes, profRes] = await Promise.all([
      supabase.from('accounts').select('settings').eq('id', accountId).single(),
      supabase.from('profiles').select('*').order('full_name')
    ]);
    const os = acctRes.data?.settings?.order_settings;
    setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? os.levels : [] });
    setAssignmentMode(acctRes.data?.settings?.assignment_mode || 'area');
    setProfiles((profRes.data || []) as Profile[]);
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
    if (user?.id) {
      await ensureDefaultSectionsAndFields(accountId, 'contact', user.id, supabase);
    }
    const { data: fields } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('account_id', accountId)
      .eq('module_name', 'contact')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    
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

    const formDataMap = {
      company,
      name,
      phone,
      whatsapp,
      email,
      hierarchy_level: hierarchyLevel,
      address,
      area,
      city,
      state: stateField,
      country,
      pincode,
      employee_id: assignmentMode === 'direct' ? (employeeId || null) : null,
    };

    const cfError = validateRequiredCustomFields(renderedCustomFields, customValues, formDataMap);
    if (cfError) {
      toast.error(cfError);
      return;
    }
    if (hierarchy.enabled && hierarchyLevel == null) {
      toast.error('Customer Level is required when sales hierarchy is enabled');
      return;
    }

    if (!isEdit && dupMatch?.exact) {
      toast.error('A customer with this phone number already exists');
      return;
    }
    
    if (isModuleEnabled('whatsapp') && !whatsapp.trim()) {
      toast.error('WhatsApp Number is required');
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
        whatsapp: whatsapp.trim() || null,
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
        employee_id: assignmentMode === 'direct' ? (employeeId || null) : null,
        // Territory Master (authoritative geography). Clearing the review flag
        // once a territory is chosen resolves any "needs migration" state.
        ...(territoryEnabled
          ? { territory_id: territoryId, needs_territory_review: territoryId ? false : needsTerritoryReview }
          : {}),
        ...(isModuleEnabled('payment') ? {
          credit_limit: creditLimit ? parseFloat(creditLimit) : null,
          credit_days: creditDays ? parseInt(creditDays, 10) : null,
          opening_balance: openingBalance ? parseFloat(openingBalance) : 0,
        } : {}),
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

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <CustomFieldsSectionRenderer
            accountId={accountId}
            moduleName="contact"
            customFields={renderedCustomFields}
            customValues={customValues}
            onChange={(fieldId, val) =>
              setCustomValues((prev) => ({ ...prev, [fieldId]: val }))
            }
            formData={{
              company,
              name,
              phone,
              email,
              hierarchy_level: hierarchyLevel,
              address,
              area,
              city,
              state: stateField,
              country,
              pincode,
            }}
            onFormDataChange={(key, val) => {
              if (key === 'company') setCompany(val);
              if (key === 'name') setName(val);
              if (key === 'phone') {
                setPhone(val);
                if (dupMatch) setDupMatch(null);
              }
              if (key === 'email') setEmail(val);
              if (key === 'hierarchy_level') setHierarchyLevel(val ? parseInt(val) : null);
              if (key === 'address') setAddress(val);
              if (key === 'area') setArea(val);
              if (key === 'city') setCity(val);
              if (key === 'state') setStateField(val);
              if (key === 'country') setCountry(val);
              if (key === 'pincode') setPincode(val);
            }}
            renderCustomSystemField={(fld) => {
              if (fld.system_key === 'phone') {
                return (
                  <div className="space-y-1">
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
                    {dupMatch && (
                      <div
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                          dupMatch.exact
                            ? 'border-red-500/40 bg-red-500/10 text-red-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        }`}
                      >
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
                    )}
                  </div>
                );
              }
              if (fld.system_key === 'hierarchy_level') {
                if (!hierarchy.enabled) return null;
                return (
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
                );
              }
              if (fld.system_key === 'whatsapp') {
                if (!isModuleEnabled('whatsapp')) return null;
                fld.is_required = true;
                return (
                  <div className="space-y-1">
                    <Input
                      id="cf-whatsapp"
                      value={whatsapp}
                      onChange={(e) => {
                        setWhatsapp(e.target.value);
                        setSameAsPhone(false);
                      }}
                      className="bg-muted border-border"
                      placeholder="+91..."
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <input 
                        type="checkbox" 
                        id="sameAsPhone" 
                        checked={sameAsPhone}
                        onChange={(e) => {
                          setSameAsPhone(e.target.checked);
                          if (e.target.checked) setWhatsapp(phone);
                        }}
                      />
                      <Label htmlFor="sameAsPhone" className="text-xs text-muted-foreground">Same as Phone Number</Label>
                    </div>
                  </div>
                );
              }
              if (fld.system_key === 'employee_id') {
                return (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Assign Employee</Label>
                    <SearchableSelect
                      value={employeeId}
                      onChange={setEmployeeId}
                      options={profiles.map((p) => ({
                        label: p.full_name || p.email,
                        value: p.id,
                      }))}
                      placeholder="Select employee..."
                    />
                  </div>
                );
              }
              return undefined;
            }}
          />

          {territoryEnabled && enabledLevels(territorySettings).length > 0 && (
            <div className="space-y-3 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Territory (Geography)</span>
                {needsTerritoryReview && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-500 gap-1">
                    <AlertTriangle className="size-2.5" /> needs review
                  </Badge>
                )}
              </div>
              <TerritoryPicker
                rows={territoryRows}
                settings={territorySettings}
                value={territoryId}
                onChange={setTerritoryId}
                onPathResolve={(pathTerritories) => {
                  let c = '', s = '', t = '', a = '';
                  pathTerritories.forEach(terr => {
                    if (terr.level === 1) c = terr.name;
                    else if (terr.level === 2) s = terr.name;
                    else if (terr.level === 3) t = terr.name;
                    else if (terr.level === 4) a = terr.name;
                  });
                  if (c) setCountry(c);
                  if (s) setStateField(s);
                  if (t) setCity(t);
                  if (a) setArea(a);
                }}
              />
            </div>
          )}

          <div className="space-y-3 pt-2 border-t border-border/50">
            <span className="text-xs font-medium text-muted-foreground">GPS Coordinates (Optional)</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Latitude</Label>
                <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="e.g. 19.1197" className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Longitude</Label>
                 <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="e.g. 72.8464" className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs" />
              </div>
            </div>
          </div>

          {isModuleEnabled('payment') && (
            <div className="space-y-3 pt-4 border-t border-border/50">
              <h4 className="text-sm font-semibold text-foreground">Financial Settings</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Two of these are money and one is a day count. They were three
                    identical number boxes, which invited typing a rupee value into
                    Credit Days. Affordances only — behaviour is unchanged. */}
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Credit Limit</Label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{currencySymbol}</span>
                    <Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="0.00" disabled={!canEditCreditTerms} className="bg-muted border-border text-foreground h-8 text-xs pl-6 disabled:opacity-60" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Credit Days</Label>
                  <div className="relative">
                    <Input type="number" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} placeholder="30" disabled={!canEditCreditTerms} className="bg-muted border-border text-foreground h-8 text-xs pr-12 disabled:opacity-60" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">days</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Opening Balance</Label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{currencySymbol}</span>
                    <Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0.00" disabled={!canEditOpeningBalance} className="bg-muted border-border text-foreground h-8 text-xs pl-6 disabled:opacity-60" />
                  </div>
                </div>
                {(!canEditCreditTerms || !canEditOpeningBalance) && (
                  <p className="md:col-span-3 text-xs text-muted-foreground">
                    Some financial fields are locked. Changing a customer&apos;s credit terms or
                    opening balance needs a finance permission.
                  </p>
                )}
              </div>
            </div>
          )}

          {asPage ? (
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
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
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
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
            </div>
          )}
        </form>
  );

  if (asPage) {
    return (
      <div className="p-8 w-full max-w-none space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 w-9 border border-border hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4 text-foreground" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" />
                {isEdit ? 'Edit Customer' : 'Add New Customer'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isEdit ? 'Update the contact details below.' : 'Capture a new customer and fill in their details.'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {formContent}
        </div>
      </div>
    );
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
        {formContent}
      </DialogContent>
    </Dialog>
  );
}

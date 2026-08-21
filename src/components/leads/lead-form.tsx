"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerritoryPicker } from "@/components/territories/territory-picker";
import { getTerritoryRows, getAccountTerritorySettings } from "@/lib/territories/api";
import { DEFAULT_TERRITORY_SETTINGS, enabledLevels } from "@/lib/territories/settings";
import type { Territory, TerritorySettings } from "@/lib/territories/types";
import { Loader2, UserPlus } from "lucide-react";
import { FormPageShell } from "@/components/shared";
import { logModuleActivity } from "@/lib/activities";
import { CustomFieldsSectionRenderer } from "@/components/custom-fields/custom-fields-section-renderer";
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from "@/lib/custom-fields";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { Tag, CustomField } from "@/types";

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: any | null; // null for creation, populated for editing
  onSaved: (savedId?: string) => void;
  asPage?: boolean;
}

export function LeadForm({ open, onOpenChange, lead, onSaved, asPage = false }: LeadFormProps) {
  const { accountId, user, isModuleEnabled } = useAuth();
  const territoryEnabled = isModuleEnabled('territory');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [territorySettings, setTerritorySettings] = useState<TerritorySettings>(DEFAULT_TERRITORY_SETTINGS);
  const [territoryRows, setTerritoryRows] = useState<Territory[]>([]);
  const [territoryId, setTerritoryId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "", contact_person: "", whatsapp: "", email: "", source: "", industry: "", status: "",
    address: "", city: "", state: "", country: "", latitude: "", longitude: ""
  });
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const [statuses, setStatuses] = useState<{id: string, name: string}[]>([]);
  const [sources, setSources] = useState<{id: string, name: string}[]>([]);
  const [industries, setIndustries] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    if (open && accountId) {
      if (lead) {
        setFormData({
          name: lead.name || "", contact_person: lead.contact_person || "", whatsapp: lead.whatsapp || "", email: lead.email || "",
          source: lead.source || "", industry: lead.industry || "", status: lead.status || "", address: lead.address || "",
          city: lead.city || "", state: lead.state || "", country: lead.country || "",
          latitude: lead.latitude || "", longitude: lead.longitude || ""
        });
      } else {
        setFormData({
          name: "", contact_person: "", whatsapp: "+91", email: "", source: "", industry: "", status: "",
          address: "", city: "", state: "", country: "", latitude: "", longitude: ""
        });
      }
      setTerritoryId((lead as (typeof lead) & { territory_id?: string | null })?.territory_id ?? null);
      fetchLookups();
      if (territoryEnabled) fetchTerritoryData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead, accountId]);

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
      /* optional enrichment */
    }
  }

  async function fetchLookups() {
    if (!accountId) return;
    const supabase = createClient();
    if (user?.id) {
      await ensureDefaultSectionsAndFields(accountId, 'lead', user.id, supabase);
    }
    const [statusRes, sourceRes, industryRes, tagsRes, cfRes] = await Promise.all([
      supabase.from("lead_statuses").select("id, name").eq("account_id", accountId).order("position"),
      supabase.from("lead_sources").select("id, name").eq("account_id", accountId).order("position"),
      supabase.from("lead_industries").select("id, name").eq("account_id", accountId).order("position"),
      supabase.from("tags").select("*").eq("account_id", accountId).order("name"),
      supabase.from("custom_fields").select("*").eq("account_id", accountId).eq("module_name", "lead").order("position", { ascending: true }).order("created_at", { ascending: true })
    ]);

    if (statusRes.data) setStatuses(statusRes.data);
    if (sourceRes.data) setSources(sourceRes.data);
    if (industryRes.data) setIndustries(industryRes.data);
    if (tagsRes.data) setTags(tagsRes.data);

    if (cfRes.data) {
      setCustomFields(cfRes.data as CustomField[]);
      if (lead?.id) {
        const { data: values } = await supabase
          .from("lead_custom_values")
          .select("custom_field_id, value")
          .eq("lead_id", lead.id);

        if (values) {
          const map: Record<string, string> = {};
          values.forEach((v) => {
            if (v.value !== null) {
              map[v.custom_field_id] = String(v.value);
            }
          });
          setCustomValues(map);
        }
      } else {
        setCustomValues({});
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !user?.id) {
      toast.error("You must be logged in to an account to save a lead");
      return;
    }
    if (!formData.name.trim()) {
      toast.error("Business / Lead Name is required");
      return;
    }
    if (isModuleEnabled('whatsapp') && !formData.whatsapp.trim()) {
      toast.error("WhatsApp Number is required");
      return;
    }

    const errorMsg = validateRequiredCustomFields(customFields, customValues, formData);
    if (errorMsg) {
      toast.error(errorMsg);
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();

    const payload = {
      account_id: accountId,
      owner_id: user.id,
      user_id: user.id,
      name: formData.name.trim(),
      contact_person: formData.contact_person.trim() || null,
      whatsapp: formData.whatsapp.trim() || null,
      email: formData.email.trim() || null,
      source: formData.source.trim() || null,
      industry: formData.industry.trim() || null,
      status: formData.status.trim() || null,
      address: formData.address.trim() || null,
      city: formData.city.trim() || null,
      state: formData.state.trim() || null,
      country: formData.country.trim() || null,
      latitude: formData.latitude.trim() || null,
      longitude: formData.longitude.trim() || null,
      collaborator_ids: collaboratorIds,
      ...(territoryEnabled ? { territory_id: territoryId } : {}),
    };

    let savedId = lead?.id;
    let saveError = null;

    if (lead?.id) {
      const { error } = await supabase.from("leads").update(payload).eq("id", lead.id);
      saveError = error;
    } else {
      const { data, error } = await supabase.from("leads").insert(payload).select("id").single();
      saveError = error;
      if (data) savedId = data.id;
    }

    if (saveError) {
      toast.error("Failed to save lead: " + saveError.message);
    } else if (savedId) {
      const cfUpserts = Object.entries(customValues)
        .filter(([_, val]) => val !== undefined && val !== null && String(val).trim() !== "")
        .map(([fieldId, val]) => ({
          lead_id: savedId,
          custom_field_id: fieldId,
          value: String(val),
        }));

      if (cfUpserts.length > 0) {
        await supabase.from("lead_custom_values").delete().eq("lead_id", savedId);
        await supabase.from("lead_custom_values").insert(cfUpserts);
      }

      await logModuleActivity(supabase, {
        moduleName: "lead",
        recordId: savedId,
        action: lead ? "updated" : "created",
        message: lead ? `Lead details updated` : `Lead created`,
      });

      toast.success(lead ? "Lead updated successfully!" : "Lead added successfully!");
      onOpenChange(false);
      onSaved(savedId);
    }
    setIsSubmitting(false);
  }

  const GEO_SYSTEM_KEYS = ['country', 'state', 'city', 'area'];
  const renderedCustomFields = useMemo(() => {
    return territoryEnabled
      ? customFields.filter((f) => !(f.system_key && GEO_SYSTEM_KEYS.includes(f.system_key)))
      : customFields;
  }, [customFields, territoryEnabled]);

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 py-4">
        <CustomFieldsSectionRenderer
          accountId={accountId}
          moduleName="lead"
          customFields={renderedCustomFields}
          customValues={customValues}
          onChange={(fieldId, val) =>
            setCustomValues((prev) => ({ ...prev, [fieldId]: val }))
          }
          formData={{
            name: formData.name,
            contact_person: formData.contact_person,
            whatsapp: formData.whatsapp,
            email: formData.email,
            status: formData.status,
            source: formData.source,
            industry: formData.industry,
            address: formData.address,
            city: formData.city,
            state: formData.state,
            country: formData.country,
          }}
          onFormDataChange={(key, val) => {
            setFormData((prev) => ({ ...prev, [key]: val }));
          }}
          renderCustomSystemField={(fld) => {
            const k = (fld.system_key || '').toLowerCase();
            const nameLower = (fld.field_name || '').toLowerCase();
            if (k === 'status' || k === 'lead_status' || nameLower === 'lead status' || nameLower === 'status') {
              return (
                <SearchableSelect
                  value={formData.status}
                  onChange={(val) => setFormData((prev) => ({ ...prev, status: val }))}
                  options={statuses.map((s) => ({ value: s.name, label: s.name }))}
                  placeholder="Select status..."
                  className="bg-muted border-border"
                />
              );
            }
            if (k === 'source' || k === 'lead_source' || nameLower === 'lead source' || nameLower === 'source') {
              return (
                <SearchableSelect
                  value={formData.source}
                  onChange={(val) => setFormData((prev) => ({ ...prev, source: val }))}
                  options={sources.map((s) => ({ value: s.name, label: s.name }))}
                  placeholder="Select source..."
                  className="bg-muted border-border"
                />
              );
            }
            if (k === 'industry' || k === 'lead_industry' || nameLower === 'industry' || nameLower === 'lead industry') {
              return (
                <SearchableSelect
                  value={formData.industry}
                  onChange={(val) => setFormData((prev) => ({ ...prev, industry: val }))}
                  options={industries.map((i) => ({ value: i.name, label: i.name }))}
                  placeholder="Select industry..."
                  className="bg-muted border-border"
                />
              );
            }
            if (k === 'city' || nameLower === 'city') {
              return (
                <Input
                  value={formData.city}
                  onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                  onBlur={(e) => {
                    const val = e.target.value.toLowerCase().trim();
                    if (!val) return;
                    const cityLookup: Record<string, { state: string; country: string }> = {
                      mumbai: { state: 'Maharashtra', country: 'India' },
                      delhi: { state: 'Delhi', country: 'India' },
                      bangalore: { state: 'Karnataka', country: 'India' },
                      pune: { state: 'Maharashtra', country: 'India' },
                      ahmedabad: { state: 'Gujarat', country: 'India' },
                      chennai: { state: 'Tamil Nadu', country: 'India' },
                      'new york': { state: 'New York', country: 'United States' },
                      london: { state: 'England', country: 'United Kingdom' },
                      dubai: { state: 'Dubai', country: 'United Arab Emirates' },
                    };
                    if (cityLookup[val]) {
                      setFormData((prev) => ({
                        ...prev,
                        state: prev.state || cityLookup[val].state,
                        country: prev.country || cityLookup[val].country,
                      }));
                    }
                  }}
                />
              );
            }
            if (k === 'whatsapp') {
              if (!isModuleEnabled('whatsapp')) return null;
              fld.is_required = true;
              return (
                <div className="space-y-1">
                  <Input
                    value={formData.whatsapp}
                    onChange={(e) => setFormData((prev) => ({ ...prev, whatsapp: e.target.value }))}
                    className="bg-muted border-border"
                    placeholder="+91..."
                  />
                </div>
              );
            }
            return undefined;
          }}
        />

        {territoryEnabled && enabledLevels(territorySettings).length > 0 && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            <span className="text-xs font-medium text-muted-foreground">Territory (Area) — controls which field employee sees this lead</span>
              <TerritoryPicker
                rows={territoryRows}
                settings={territorySettings}
                value={territoryId}
                onChange={setTerritoryId}
                onPathResolve={(pathTerritories) => {
                  let c = '', s = '', t = '';
                  pathTerritories.forEach(terr => {
                    if (terr.level === 1) c = terr.name;
                    else if (terr.level === 2) s = terr.name;
                    else if (terr.level === 3) t = terr.name;
                  });
                  setFormData((prev) => ({
                    ...prev,
                    country: c || prev.country,
                    state: s || prev.state,
                    city: t || prev.city
                  }));
                }}
              />
            </div>
        )}

        <div className="space-y-3 pt-2 border-t border-border/50">
          <span className="text-xs font-medium text-muted-foreground">GPS Coordinates (Optional)</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Latitude</Label>
              <Input value={formData.latitude} onChange={(e) => setFormData((prev) => ({ ...prev, latitude: e.target.value }))} placeholder="e.g. 19.0760" className="h-8 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Longitude</Label>
              <Input value={formData.longitude} onChange={(e) => setFormData((prev) => ({ ...prev, longitude: e.target.value }))} placeholder="e.g. 72.8777" className="h-8 text-xs" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border mt-6">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Lead
        </Button>
      </div>
    </form>
  );

  if (asPage) {
    return (
      <FormPageShell
        icon={UserPlus}
        title={lead ? 'Edit Lead' : 'Add New Lead'}
        subtitle={lead ? 'Update lead details below.' : 'Create a new lead in your CRM.'}
        onBack={() => onOpenChange(false)}
      >
        {formContent}
      </FormPageShell>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit Lead" : "Add New Lead"}</DialogTitle>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
}

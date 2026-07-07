"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { logModuleActivity } from "@/lib/activities";
import { CustomFieldInput } from "@/components/ui/custom-field-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { Tag, CustomField } from "@/types";

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: any | null; // null for creation, populated for editing
  onSaved: () => void;
}

export function LeadForm({ open, onOpenChange, lead, onSaved }: LeadFormProps) {
  const { accountId, user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: "", contact_person: "", whatsapp: "", email: "", source: "", industry: "", status: "",
    address: "", city: "", state: "", country: "", latitude: "", longitude: ""
  });

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
          name: "", contact_person: "", whatsapp: "", email: "", source: "", industry: "", status: "",
          address: "", city: "", state: "", country: "", latitude: "", longitude: ""
        });
      }
      fetchLookups();
    }
  }, [open, lead, accountId]);

  async function fetchLookups() {
    if (!accountId) return;
    const supabase = createClient();
    
    const [cfRes, stRes, soRes, inRes] = await Promise.all([
      supabase.from("custom_fields").select("*").or("module_name.eq.lead,module_name.is.null").order("field_name"),
      supabase.from("lead_statuses").select("id, name").eq("account_id", accountId).order("position"),
      supabase.from("lead_sources").select("id, name").eq("account_id", accountId).order("position"),
      supabase.from("lead_industries").select("id, name").eq("account_id", accountId).order("position")
    ]);
    
    if (stRes.data) {
      setStatuses(stRes.data);
      if (!lead?.id && stRes.data.length > 0 && !formData.status) {
        setFormData(prev => ({ ...prev, status: stRes.data[0].name }));
      }
    }
    if (soRes.data) setSources(soRes.data);
    if (inRes.data) setIndustries(inRes.data);

    if (cfRes.data) {
      setCustomFields(cfRes.data as CustomField[]);
      if (lead?.id) {
        const { data: vals } = await supabase.from("lead_custom_values").select("*").eq("lead_id", lead.id);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    setIsSubmitting(true);
    
    const supabase = createClient();
    const payload = {
      account_id: accountId,
      name: formData.name,
      contact_person: formData.contact_person,
      whatsapp: formData.whatsapp,
      email: formData.email,
      source: formData.source,
      industry: formData.industry,
      status: formData.status,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      country: formData.country,
      latitude: formData.latitude ? parseFloat(formData.latitude) : null,
      longitude: formData.longitude ? parseFloat(formData.longitude) : null,
    };

    let error;
    let savedId = lead?.id;

    if (lead?.id) {
      const { error: updateErr } = await supabase.from("leads").update(payload).eq("id", lead.id);
      error = updateErr;
    } else {
      if (!user) {
        toast.error("Not authenticated");
        setIsSubmitting(false);
        return;
      }
      const insertPayload = { ...payload, user_id: user.id };
      const { data: insertData, error: insertErr } = await supabase.from("leads").insert(insertPayload).select().single();
      error = insertErr;
      if (insertData) savedId = insertData.id;
    }

    if (error) {
      toast.error(lead ? "Failed to update lead" : "Failed to add lead");
    } else if (savedId) {
      
      // Sync custom fields
      const cfUpserts = customFields.filter(f => customValues[f.id] !== undefined).map(f => ({
         lead_id: savedId!,
         custom_field_id: f.id,
         value: customValues[f.id]
      }));
      if (cfUpserts.length > 0) {
        await supabase.from('lead_custom_values').delete().eq('lead_id', savedId);
        await supabase.from('lead_custom_values').insert(cfUpserts);
      }

      await logModuleActivity(supabase, {
        moduleName: "lead",
        recordId: savedId,
        action: lead ? "updated" : "created",
        message: lead ? `Lead details updated` : `Lead created`,
      });

      toast.success(lead ? "Lead updated successfully!" : "Lead added successfully!");
      onOpenChange(false);
      onSaved();
    }
    setIsSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{lead ? "Edit Lead" : "Add New Lead"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Primary Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Business / Lead Name *</Label>
                  <Input id="name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contact_person">Contact Person</Label>
                  <Input id="contact_person" value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="whatsapp">WhatsApp Number</Label>
                  <Input id="whatsapp" value={formData.whatsapp} onChange={e => setFormData({ ...formData, whatsapp: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="status">Lead Status</Label>
                  <SearchableSelect
                    value={formData.status}
                    onChange={(val) => setFormData({ ...formData, status: val })}
                    options={statuses.map(s => ({ value: s.name, label: s.name }))}
                    placeholder="Select Status"
                    searchPlaceholder="Search statuses..."
                    emptyMessage="Setup statuses in Settings"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="source">Source</Label>
                  <SearchableSelect
                    value={formData.source}
                    onChange={(val) => setFormData({ ...formData, source: val })}
                    options={sources.map(s => ({ value: s.name, label: s.name }))}
                    placeholder="Select Source"
                    searchPlaceholder="Search sources..."
                    emptyMessage="Setup sources in Settings"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="industry">Industry</Label>
                  <SearchableSelect
                    value={formData.industry}
                    onChange={(val) => setFormData({ ...formData, industry: val })}
                    options={industries.map(s => ({ value: s.name, label: s.name }))}
                    placeholder="Select Industry"
                    searchPlaceholder="Search industries..."
                    emptyMessage="Setup industries in Settings"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Location Details</h4>
              <div className="grid gap-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input 
                    id="city" 
                    value={formData.city} 
                    onChange={e => setFormData({ ...formData, city: e.target.value })} 
                    onBlur={(e) => {
                      const val = e.target.value.toLowerCase().trim();
                      if (!val) return;
                      // TODO: Replace this static mapping with a real Geocoding API if preferred
                      const cityLookup: Record<string, {state: string, country: string}> = {
                        "mumbai": { state: "Maharashtra", country: "India" },
                        "delhi": { state: "Delhi", country: "India" },
                        "bangalore": { state: "Karnataka", country: "India" },
                        "pune": { state: "Maharashtra", country: "India" },
                        "ahmedabad": { state: "Gujarat", country: "India" },
                        "chennai": { state: "Tamil Nadu", country: "India" },
                        "new york": { state: "New York", country: "United States" },
                        "london": { state: "England", country: "United Kingdom" },
                        "dubai": { state: "Dubai", country: "United Arab Emirates" }
                      };
                      if (cityLookup[val]) {
                        setFormData(prev => ({
                          ...prev,
                          state: prev.state || cityLookup[val].state,
                          country: prev.country || cityLookup[val].country
                        }));
                      }
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" value={formData.state} onChange={e => setFormData({ ...formData, state: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input id="latitude" value={formData.latitude} onChange={e => setFormData({ ...formData, latitude: e.target.value })} placeholder="e.g. 19.0760" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input id="longitude" value={formData.longitude} onChange={e => setFormData({ ...formData, longitude: e.target.value })} placeholder="e.g. 72.8777" />
                </div>
              </div>
            </div>

            {customFields.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">Custom Fields</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {customFields.map((field) => (
                    <div key={field.id} className="space-y-2">
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

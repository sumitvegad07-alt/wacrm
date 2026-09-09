"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Profile, Contact, Lead, PipelineStage, Deal } from "@/types";
import { DealItemsTable, type PartialDealItem } from "@/components/deals/deal-items-table";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";
import { useAuth } from "@/hooks/use-auth";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FormPageShell, FormActions, FormSection, EntityTypeToggle } from "@/components/shared";

export default function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const dealId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();
  const { account } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dealFor, setDealFor] = useState<"customer" | "lead">("customer");
  const [creatorName, setCreatorName] = useState<string>("Unknown Creator");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [items, setItems] = useState<PartialDealItem[]>([]);

  const [form, setForm] = useState({
    title: "",
    value: "",
    currency: "INR",
    contact_id: "",
    lead_id: "",
    assigned_to: "",
    stage_id: "",
    expected_close_date: "",
    notes: "",
    status: "open"
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [
        { data: profilesData },
        { data: contactsData },
        { data: leadsData },
        { data: productsData },
        { data: stagesData },
        { data: dealData, error },
        { data: itemsData }
      ] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name", { ascending: true }),
        supabase.from("contacts").select("*").order("name", { ascending: true }),
        supabase.from("leads").select("*").order("name", { ascending: true }),
        supabase.from("products").select("*, tax_slab:tax_slabs(rate)").order("name", { ascending: true }),
        supabase.from("pipeline_stages").select("*").order("position", { ascending: true }),
        supabase.from("deals").select("*, creator:profiles!creator_id(*)").eq("id", dealId).single(),
        supabase.from("deal_items").select("*").eq("deal_id", dealId).order("position", { ascending: true })
      ]);

      if (profilesData) setProfiles(profilesData as Profile[]);
      if (contactsData) setContacts(contactsData as Contact[]);
      if (leadsData) setLeads(leadsData as Lead[]);
      if (productsData) setProducts(productsData || []);
      if (stagesData) setStages(stagesData as PipelineStage[]);
      if (itemsData) setItems(itemsData as PartialDealItem[]);

      if (error || !dealData) {
        toast.error("Deal not found");
        router.push("/pipelines");
        return;
      }

      setDealFor(dealData.deal_for === "lead" ? "lead" : "customer");
      setCollaboratorIds(dealData.collaborator_ids || []);
      if (dealData.creator) {
        setCreatorName((dealData.creator as any).full_name || (dealData.creator as any).email || "Creator");
      } else {
        // Fallback check profile list
        const cProf = profilesData?.find((p: any) => p.id === dealData.creator_id || p.user_id === dealData.creator_id);
        if (cProf) setCreatorName(cProf.full_name || cProf.email);
      }

      setForm({
        title: dealData.title || "",
        value: dealData.value ? String(dealData.value) : "",
        currency: dealData.currency || "INR",
        contact_id: dealData.contact_id || "",
        lead_id: dealData.lead_id || "",
        assigned_to: dealData.assigned_to || "",
        stage_id: dealData.stage_id || "",
        expected_close_date: dealData.expected_close_date ? dealData.expected_close_date.split("T")[0] : "",
        notes: dealData.notes || "",
        status: dealData.status || "open"
      });
      setLoading(false);
    }
    loadData();
  }, [dealId, supabase, router]);

  const handleSaveDeal = async () => {
    if (dealFor === "customer" && !form.contact_id) {
      toast.error("Please select a Customer / Contact");
      return;
    }
    if (dealFor === "lead" && !form.lead_id) {
      toast.error("Please select a Lead");
      return;
    }

    setSaving(true);
    try {
      const itemsTotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const targetName = dealFor === "customer"
        ? (contacts.find(c => c.id === form.contact_id)?.name || "Customer Deal")
        : (leads.find(l => l.id === form.lead_id)?.name || "Lead Deal");

      const payload: any = {
        title: targetName,
        value: itemsTotal,
        currency: (account as any)?.default_currency || "INR",
        deal_for: dealFor,
        contact_id: dealFor === "customer" ? form.contact_id : null,
        lead_id: dealFor === "lead" ? form.lead_id : null,
        collaborator_ids: collaboratorIds,
        stage_id: form.stage_id || null,
        expected_close_date: form.expected_close_date || null,
        notes: form.notes.trim() || null,
        status: form.status
      };

      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", dealId);

      if (error) throw error;

      // Sync deal items: delete existing & re-insert
      await supabase.from("deal_items").delete().eq("deal_id", dealId);
      if (items.length > 0) {
        const itemPayloads = items.map((item, idx) => ({
          deal_id: dealId,
          product_id: item.product_id || null,
          product_name: item.product_name || "Item",
          unit: item.unit || "Nos",
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          tax_rate: Number(item.tax_rate) || 0,
          tax_amount: Number(item.tax_amount) || 0,
          sub_total: Number(item.sub_total) || 0,
          total: Number(item.total) || 0,
          position: idx
        }));
        await supabase.from("deal_items").insert(itemPayloads);
      }

      toast.success("Deal updated successfully!");
      router.push(`/deals/${dealId}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  const computedValue = items.length > 0
    ? items.reduce((sum, item) => sum + (Number(item.total) || 0), 0)
    : (form.value ? parseFloat(form.value) : 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <FormPageShell
      icon={Pencil}
      title="Edit Deal"
      subtitle="Update deal details, stage, collaborators, and product line items."
      onBack={() => router.push(`/deals/${dealId}`)}
      width="none"
      footer={
        <FormActions
          onCancel={() => router.push(`/deals/${dealId}`)}
          onSave={handleSaveDeal}
          saving={saving}
          saveLabel="Save Changes"
        />
      }
    >
      <div className="space-y-8">
        <FormSection title="Opportunity Details">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground flex items-center gap-1">
                Deal For <span className="text-red-400">*</span>
              </Label>
              <EntityTypeToggle
                value={dealFor}
                onChange={(v) => {
                  setDealFor(v);
                  setForm(prev => ({ ...prev, ...(v === "customer" ? { lead_id: "" } : { contact_id: "" }) }));
                }}
                options={[
                  { value: "customer", label: "Customer" },
                  { value: "lead", label: "Lead" },
                ]}
              />
            </div>

            {dealFor === "customer" ? (
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">
                  Customer <span className="text-red-400">*</span>
                </Label>
                <SearchableSelect
                  value={form.contact_id}
                  onChange={v => setForm({ ...form, contact_id: v })}
                  placeholder="Select a customer"
                  searchPlaceholder="Search customers..."
                  emptyMessage="No customers found."
                  options={contacts.map(c => ({
                    value: c.id,
                    label: c.name || c.phone || "Unnamed Contact"
                  }))}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">
                  Lead <span className="text-red-400">*</span>
                </Label>
                <SearchableSelect
                  value={form.lead_id}
                  onChange={v => setForm({ ...form, lead_id: v })}
                  placeholder="Select a lead"
                  searchPlaceholder="Search leads..."
                  emptyMessage="No leads found."
                  options={leads.map(l => ({
                    value: l.id,
                    label: `${l.name} ${l.whatsapp ? `(${l.whatsapp})` : ""}`
                  }))}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-muted-foreground">Pipeline Stage</Label>
              <SearchableSelect
                value={form.stage_id}
                onChange={v => setForm({ ...form, stage_id: v })}
                placeholder="Select a stage"
                searchPlaceholder="Search stages..."
                options={stages.map(s => ({
                  value: s.id,
                  label: s.name
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v || "open" })}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </FormSection>

        <FormSection title="Collaboration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Collaborators</Label>
              <CollaboratorsSelect
                profiles={profiles}
                selectedIds={collaboratorIds}
                onChange={setCollaboratorIds}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Product Line Items">
          <DealItemsTable items={items} onChange={setItems} products={products} />
        </FormSection>

        <FormSection title="Additional Details">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            <div className="space-y-2">
              <Label htmlFor="expected_close_date" className="text-muted-foreground">Expected Close Date</Label>
              <Input
                id="expected_close_date"
                type="date"
                className="bg-background text-foreground"
                value={form.expected_close_date}
                onChange={e => setForm({ ...form, expected_close_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-muted-foreground">Notes &amp; Requirements</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Enter key details, customer pain points, or next steps..."
                rows={4}
              />
            </div>
          </div>
        </FormSection>
      </div>
    </FormPageShell>
  );
}

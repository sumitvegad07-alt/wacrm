"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { Profile, Contact, Lead, PipelineStage } from "@/types";
import { DealItemsTable, type PartialDealItem } from "@/components/deals/deal-items-table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FormPageShell, FormActions, FormSection, EntityTypeToggle } from "@/components/shared";
import { isWonLostName } from "@/lib/pipelines/default-stages";

export default function NewDealPage() {
  const router = useRouter();
  const supabase = createClient();
  const { profile, account, user } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [defaultPipelineId, setDefaultPipelineId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const [dealFor, setDealFor] = useState<"customer" | "lead">("customer");
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
    notes: ""
  });

  useEffect(() => {
    async function loadData() {
      const [
        { data: profilesData },
        { data: contactsData },
        { data: leadsData },
        { data: productsData },
        { data: pipelinesData },
        { data: stagesData }
      ] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name", { ascending: true }),
        supabase.from("contacts").select("*").order("name", { ascending: true }),
        supabase.from("leads").select("*").eq("is_active", true).order("name", { ascending: true }),
        supabase.from("products").select("*, tax_slab:tax_slabs(rate)").order("name", { ascending: true }),
        supabase.from("pipelines").select("*").order("created_at", { ascending: true }),
        supabase.from("pipeline_stages").select("*").order("position", { ascending: true })
      ]);

      if (profilesData) setProfiles(profilesData as Profile[]);
      if (contactsData) setContacts(contactsData as Contact[]);
      if (leadsData) setLeads(leadsData as Lead[]);
      if (productsData) setProducts(productsData || []);

      let pId = "";
      if (pipelinesData && pipelinesData.length > 0) {
        const defaultP = pipelinesData.find((p: any) => p.is_default) || pipelinesData[0];
        pId = defaultP.id;
        setDefaultPipelineId(pId);
      }

      if (stagesData && stagesData.length > 0) {
        const filteredStages = pId ? stagesData.filter((s: any) => s.pipeline_id === pId) : stagesData;
        setStages(filteredStages as PipelineStage[]);
        if (filteredStages.length > 0) {
          setForm(prev => ({ ...prev, stage_id: filteredStages[0].id }));
        }
      }

      if (profile?.id) {
        setForm(prev => ({ ...prev, assigned_to: profile.id }));
      }
    }
    loadData();
  }, [supabase, profile?.id]);

  const handleCreateDeal = async () => {
    if (dealFor === "customer" && !form.contact_id) {
      toast.error("Please select a Customer / Contact");
      return;
    }
    if (dealFor === "lead" && !form.lead_id) {
      toast.error("Please select a Lead");
      return;
    }

    setCreating(true);
    try {
      if (!user?.id) throw new Error("Not authenticated");

      const itemsTotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const targetName = dealFor === "customer"
        ? (contacts.find(c => c.id === form.contact_id)?.name || "Customer Deal")
        : (leads.find(l => l.id === form.lead_id)?.name || "Lead Deal");

      const payload: any = {
        account_id: (account as any)?.id || (profile as any)?.account_id,
        title: targetName,
        value: itemsTotal,
        currency: (account as any)?.default_currency || "INR",
        deal_for: dealFor,
        contact_id: dealFor === "customer" ? form.contact_id : null,
        lead_id: dealFor === "lead" ? form.lead_id : null,
        creator_id: user.id,
        // Owner is auto-assigned to whoever generated the deal. assigned_to is a
        // FK to profiles.id (not the auth user id), so use the profile row id.
        // Collaborators are added later from the deal detail page, not at creation.
        assigned_to: (profile as any)?.id || null,
        collaborator_ids: [],
        pipeline_id: defaultPipelineId || (stages[0]?.pipeline_id || null),
        stage_id: form.stage_id || (stages[0]?.id || null),
        expected_close_date: form.expected_close_date || null,
        notes: form.notes.trim() || null,
        status: "open",
        is_active: true,
        user_id: user.id
      };

      const { data: deal, error } = await supabase
        .from("deals")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      // Insert deal items if any
      if (items.length > 0 && deal) {
        const itemPayloads = items.map((item, idx) => ({
          deal_id: deal.id,
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

        const { error: itemsErr } = await supabase.from("deal_items").insert(itemPayloads);
        if (itemsErr) {
          console.error("Failed to insert deal items:", itemsErr);
        }
      }

      // Log deal creation in timeline
      await supabase.from("module_activities").insert({
        account_id: payload.account_id,
        user_id: user.id,
        module_name: "deal",
        record_id: deal.id,
        action: "created",
        message: `Deal ${deal.deal_number || deal.id} created`,
        details: { deal_number: deal.deal_number, value: deal.value }
      });

      toast.success("Deal created successfully!");
      router.push(`/deals/${deal.id}`);

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create deal");
    } finally {
      setCreating(false);
    }
  };

  return (
    <FormPageShell
      icon={GitBranch}
      title="Add New Deal"
      subtitle="Create a new sales opportunity for a customer or lead with line items."
      onBack={() => router.push("/pipelines")}
      width="none"
      footer={
        <FormActions
          onCancel={() => router.push("/pipelines")}
          onSave={handleCreateDeal}
          saving={creating}
          saveLabel="Create Deal"
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
                  setForm((prev) => ({ ...prev, ...(v === "customer" ? { lead_id: "" } : { contact_id: "" }) }));
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
                options={stages
                  .filter(s => !isWonLostName(s.name)) // deals are resolved Won/Lost from the detail page, not created there
                  .map(s => ({
                    value: s.id,
                    label: s.name
                  }))}
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
                rows={3}
              />
            </div>
          </div>
        </FormSection>
      </div>
    </FormPageShell>
  );
}

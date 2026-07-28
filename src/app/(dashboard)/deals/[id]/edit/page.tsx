"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Profile, Contact, PipelineStage, Deal } from "@/types";

export default function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const dealId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "",
    value: "",
    currency: "INR",
    contact_id: "",
    assigned_to: "",
    stage_id: "",
    expected_close_date: "",
    notes: "",
    status: "open"
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [{ data: profilesData }, { data: contactsData }, { data: stagesData }, { data: dealData, error }] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name", { ascending: true }),
        supabase.from("contacts").select("*").order("name", { ascending: true }),
        supabase.from("pipeline_stages").select("*").order("position", { ascending: true }),
        supabase.from("deals").select("*").eq("id", dealId).single()
      ]);

      if (profilesData) setProfiles(profilesData as Profile[]);
      if (contactsData) setContacts(contactsData as Contact[]);
      if (stagesData) setStages(stagesData as PipelineStage[]);

      if (error || !dealData) {
        toast.error("Deal not found");
        router.push("/pipelines");
        return;
      }

      setForm({
        title: dealData.title || "",
        value: dealData.value ? String(dealData.value) : "",
        currency: dealData.currency || "INR",
        contact_id: dealData.contact_id || "",
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

  const handleSaveDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Please enter a Deal Title");
      return;
    }
    if (!form.contact_id) {
      toast.error("Please select a Customer / Contact");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        title: form.title.trim(),
        value: form.value ? parseFloat(form.value) : 0,
        currency: form.currency || "INR",
        contact_id: form.contact_id,
        assigned_to: form.assigned_to || null,
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

      toast.success("Deal updated successfully!");
      router.push(`/deals/${dealId}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <Link href={`/deals/${dealId}`}>
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Pencil className="w-6 h-6 text-primary" />
              Edit Deal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Update opportunity stage, valuation, and customer details.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveDeal} className="space-y-8">
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Opportunity Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="title">Deal Title *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Enterprise License Contract - Q3"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Customer / Contact *</Label>
              <Select value={form.contact_id} onValueChange={v => setForm({ ...form, contact_id: v || "" })}>
                <SelectTrigger><SelectValue placeholder="Select Customer" /></SelectTrigger>
                <SelectContent>
                  {contacts.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name || c.phone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="value">Deal Value (₹)</Label>
              <Input
                id="value"
                type="number"
                step="any"
                value={form.value}
                onChange={e => setForm({ ...form, value: e.target.value })}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v || "INR" })}>
                <SelectTrigger><SelectValue placeholder="Currency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Pipeline Stage & Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Pipeline Stage</Label>
              <Select value={form.stage_id} onValueChange={v => setForm({ ...form, stage_id: v || "" })}>
                <SelectTrigger><SelectValue placeholder="Select Stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v || "open" })}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open / In Progress</SelectItem>
                  <SelectItem value="won">Won (Closed)</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assigned Sales Owner</Label>
              <Select value={form.assigned_to} onValueChange={v => setForm({ ...form, assigned_to: v || "" })}>
                <SelectTrigger><SelectValue placeholder="Select Team Member" /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Expected Close Date</Label>
              <Input
                id="expected_close_date"
                type="date"
                value={form.expected_close_date}
                onChange={e => setForm({ ...form, expected_close_date: e.target.value })}
              />
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="notes">Notes & Requirements</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Enter key details, customer pain points, or next steps..."
                rows={4}
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-4 pt-4">
          <Link href={`/deals/${dealId}`}>
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={saving} className="min-w-[150px]">
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}

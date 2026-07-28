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
import type { Profile, Lead } from "@/types";

export default function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const leadId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    whatsapp: "",
    company: "",
    industry: "",
    source: "",
    estimated_value: "",
    assigned_to: "",
    status: "new",
    notes: ""
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [{ data: profilesData }, { data: leadData, error }] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name", { ascending: true }),
        supabase.from("leads").select("*").eq("id", leadId).single()
      ]);

      if (profilesData) setProfiles(profilesData as Profile[]);
      if (error || !leadData) {
        toast.error("Lead not found");
        router.push("/leads");
        return;
      }

      setForm({
        name: leadData.name || "",
        email: leadData.email || "",
        phone: leadData.phone || "",
        whatsapp: leadData.whatsapp || "",
        company: leadData.company || "",
        industry: leadData.industry || "",
        source: leadData.source || "Manual",
        estimated_value: leadData.estimated_value ? String(leadData.estimated_value) : "",
        assigned_to: leadData.assigned_to || "",
        status: leadData.status || "new",
        notes: leadData.notes || ""
      });
      setLoading(false);
    }
    loadData();
  }, [leadId, supabase, router]);

  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Please fill in Name and Phone Number");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        whatsapp: form.whatsapp.trim() || form.phone.trim(),
        company: form.company.trim() || null,
        industry: form.industry.trim() || null,
        source: form.source.trim() || "Manual",
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : 0,
        assigned_to: form.assigned_to || null,
        status: form.status,
        notes: form.notes.trim() || null
      };

      const { error } = await supabase
        .from("leads")
        .update(payload)
        .eq("id", leadId);

      if (error) throw error;

      toast.success("Lead updated successfully!");
      router.push(`/leads/${leadId}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update lead");
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
          <Link href={`/leads/${leadId}`}>
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Pencil className="w-6 h-6 text-primary" />
              Edit Lead
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Update details and assignment for this lead.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveLead} className="space-y-8">
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Lead Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Lead Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Jane Doe"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="+1 234 567 8900"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp Number</Label>
              <Input
                id="whatsapp"
                value={form.whatsapp}
                onChange={e => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="+1 234 567 8900"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="jane@example.com"
              />
            </div>
          </div>
        </Card>

        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Business & Assignment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="company">Company / Organization</Label>
              <Input
                id="company"
                value={form.company}
                onChange={e => setForm({ ...form, company: e.target.value })}
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={e => setForm({ ...form, industry: e.target.value })}
                placeholder="e.g. Manufacturing"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimated_value">Estimated Deal Value (₹)</Label>
              <Input
                id="estimated_value"
                type="number"
                value={form.estimated_value}
                onChange={e => setForm({ ...form, estimated_value: e.target.value })}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Lead Source</Label>
              <Select value={form.source} onValueChange={v => setForm({ ...form, source: v || "Manual" })}>
                <SelectTrigger><SelectValue placeholder="Select Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Manual">Manual</SelectItem>
                  <SelectItem value="Website">Website</SelectItem>
                  <SelectItem value="Referral">Referral</SelectItem>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Cold Call">Cold Call</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assigned To</Label>
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
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v || "new" })}>
                <SelectTrigger><SelectValue placeholder="Select Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="notes">Notes / Remarks</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Enter any initial notes or remarks about this lead..."
                rows={4}
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-4 pt-4">
          <Link href={`/leads/${leadId}`}>
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

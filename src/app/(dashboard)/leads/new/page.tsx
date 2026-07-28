"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, UserPlus, Loader2, DollarSign, Building2, Phone, Mail, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { Profile } from "@/types";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";

export default function NewLeadPage() {
  const router = useRouter();
  const supabase = createClient();
  const { profile } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    whatsapp: "",
    company: "",
    industry: "",
    source: "",
    estimated_value: "",
    owner_id: "",
    status: "new",
    notes: ""
  });

  useEffect(() => {
    async function loadProfiles() {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true });
      if (data) {
        setProfiles(data as Profile[]);
        if (profile?.id) {
          setForm(prev => ({ ...prev, owner_id: profile.id }));
        }
      }
    }
    loadProfiles();
  }, [supabase, profile?.id]);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Please fill in Name and Phone Number");
      return;
    }

    setCreating(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not authenticated");

      const payload: any = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        whatsapp: form.whatsapp.trim() || form.phone.trim(),
        company: form.company.trim() || null,
        industry: form.industry.trim() || null,
        source: form.source || "Website",
        status: form.status || "new",
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : 0,
        owner_id: form.owner_id || profile?.id || userData.user.id,
        user_id: userData.user.id,
        collaborator_ids: collaboratorIds,
        notes: form.notes.trim() || null,
        is_active: true
      };

      const { data, error } = await supabase
        .from("leads")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      toast.success("Lead created successfully!");
      router.push(`/leads/${data.id}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create lead");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <Link href="/leads">
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <UserPlus className="w-6 h-6 text-primary" />
              Add New Lead
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Capture a new lead and assign owner and collaborators.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreateLead} className="space-y-8">
        {/* Contact Information */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Contact Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. John Doe"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp Number</Label>
              <Input
                id="whatsapp"
                value={form.whatsapp}
                onChange={e => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="Same as Phone if left empty"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="john.doe@company.com"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Lead Qualification */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Lead Qualification</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="company">Company Name</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="company"
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                  placeholder="Acme Corp"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={e => setForm({ ...form, industry: e.target.value })}
                placeholder="e.g. Technology, Retail"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Lead Source</Label>
              <Select value={form.source} onValueChange={v => setForm({ ...form, source: v || "Website" })}>
                <SelectTrigger><SelectValue placeholder="Select Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Website">Website</SelectItem>
                  <SelectItem value="Referral">Referral</SelectItem>
                  <SelectItem value="Social Media">Social Media</SelectItem>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Cold Call">Cold Call</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimated_value">Estimated Value (₹)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="estimated_value"
                  type="number"
                  step="any"
                  value={form.estimated_value}
                  onChange={e => setForm({ ...form, estimated_value: e.target.value })}
                  placeholder="0.00"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Ownership & Collaboration */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Ownership & Collaboration
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Creator (Read-only)</Label>
              <Input
                value={profile?.full_name || profile?.email || "Current User"}
                disabled
                className="bg-muted text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label>Owner / Assigned To</Label>
              <Select value={form.owner_id} onValueChange={v => setForm({ ...form, owner_id: v || "" })}>
                <SelectTrigger><SelectValue placeholder="Select Owner" /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Collaborators</Label>
              <CollaboratorsSelect
                profiles={profiles}
                selectedIds={collaboratorIds}
                onChange={setCollaboratorIds}
              />
            </div>
          </div>
        </Card>

        {/* Notes */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Additional Details</h2>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Enter key details or initial conversation notes..."
              rows={4}
            />
          </div>
        </Card>

        <div className="flex items-center justify-end gap-4 pt-4">
          <Link href="/leads">
            <Button variant="outline" type="button">Cancel</Button>
          </Link>
          <Button type="submit" disabled={creating} className="min-w-[150px]">
            {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Lead
          </Button>
        </div>
      </form>
    </div>
  );
}

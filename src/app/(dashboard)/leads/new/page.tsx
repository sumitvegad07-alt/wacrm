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
import { ArrowLeft, UserPlus, Loader2, Building2, Phone, Mail, Users, User, MapPin, Globe } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { Profile } from "@/types";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";

export default function NewLeadPage() {
  const router = useRouter();
  const supabase = createClient();
  const { profile, user } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    company: "",
    contact_person: "",
    phone: "",
    email: "",
    industry: "",
    source: "Website",
    status: "new",
    address: "",
    city: "",
    state: "",
    country: "",
    notes: ""
  });

  useEffect(() => {
    async function loadProfiles() {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true });
      if (data) setProfiles(data as Profile[]);
    }
    loadProfiles();
  }, [supabase]);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim() && !form.contact_person.trim()) {
      toast.error("Please enter a Company Name or Contact Person Name");
      return;
    }
    if (!form.phone.trim()) {
      toast.error("Please fill in Contact Number");
      return;
    }

    setCreating(true);
    try {
      if (!user?.id) throw new Error("Not authenticated");

      const payload: any = {
        name: form.company.trim() || form.contact_person.trim() || "Unnamed Lead",
        company: form.company.trim() || null,
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.phone.trim() || null,
        email: form.email.trim() || null,
        industry: form.industry.trim() || null,
        source: form.source || "Website",
        status: form.status || "new",
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country.trim() || null,
        owner_id: user.id,
        user_id: user.id,
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/leads">
            <Button variant="ghost" size="icon" className="h-9 w-9 border border-border">
              <ArrowLeft className="h-4 w-4 text-foreground" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <UserPlus className="w-6 h-6 text-primary" />
              Add New Lead
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Capture a new lead and assign collaborators.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreateLead} className="space-y-8">
        {/* Contact Information */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="company">Company Name *</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="company"
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_person">Contact Person Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="contact_person"
                  value={form.contact_person}
                  onChange={e => setForm({ ...form, contact_person: e.target.value })}
                  placeholder="e.g. John Doe"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Contact Number *</Label>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <Label htmlFor="status">Lead Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v || "new" })}>
                <SelectTrigger><SelectValue placeholder="Select Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="unqualified">Unqualified</SelectItem>
                </SelectContent>
              </Select>
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
          </div>
        </Card>

        {/* Address & Location */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Address & Location
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="Street address, apartment, suite..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                placeholder="e.g. Mumbai"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">State / Region</Label>
              <Input
                id="state"
                value={form.state}
                onChange={e => setForm({ ...form, state: e.target.value })}
                placeholder="e.g. Maharashtra"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="country"
                  value={form.country}
                  onChange={e => setForm({ ...form, country: e.target.value })}
                  placeholder="e.g. India"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Collaborators */}
        <Card className="p-6 border-border shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Collaborators
          </h2>
          <CollaboratorsSelect
            profiles={profiles}
            selectedIds={collaboratorIds}
            onChange={setCollaboratorIds}
          />
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

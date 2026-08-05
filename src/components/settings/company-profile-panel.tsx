'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';
import { Textarea } from '@/components/ui/textarea';

interface CompanyProfileData {
  name: string;
  website: string;
  registered_email: string;
  registered_contact_no: string;
  fax: string;
  contact_person_name: string;
  support_person_name: string;
  support_contact_no: string;
  address: string;
  pincode: string;
  country: string;
  state: string;
  city: string;
}

const DEFAULT_PROFILE: CompanyProfileData = {
  name: '',
  website: '',
  registered_email: '',
  registered_contact_no: '',
  fax: '',
  contact_person_name: '',
  support_person_name: '',
  support_contact_no: '',
  address: '',
  pincode: '',
  country: '',
  state: '',
  city: '',
};

export function CompanyProfilePanel() {
  const { accountId, isOwner, isAdmin } = useAuth();
  const supabase = createClient();

  const [data, setData] = useState<CompanyProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canEdit = isOwner || isAdmin;

  useEffect(() => {
    async function loadData() {
      if (!accountId) return;
      try {
        const { data: acct, error } = await supabase
          .from('accounts')
          .select('settings')
          .eq('id', accountId)
          .single();

        if (error) throw error;
        
        if (acct?.settings?.company_profile) {
          setData({ ...DEFAULT_PROFILE, ...acct.settings.company_profile });
        }
      } catch (err) {
        console.error('Failed to load company profile:', err);
        toast.error('Failed to load company profile');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [accountId, supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    setSaving(true);
    try {
      const { data: acct } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', accountId)
        .single();

      const currentSettings = acct?.settings || {};
      const newSettings = {
        ...currentSettings,
        company_profile: data,
      };

      const { error } = await supabase
        .from('accounts')
        .update({ settings: newSettings })
        .eq('id', accountId);

      if (error) throw error;
      toast.success('Company profile updated');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to save company profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof CompanyProfileData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead title="Company Profile" />
      <form onSubmit={handleSubmit} className="mt-6 space-y-8 max-w-4xl">
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">Profile Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={data.name}
                onChange={(e) => handleChange('name', e.target.value)}
                disabled={!canEdit}
                placeholder="Company Name"
              />
            </div>
            <div className="space-y-2">
              <Label>Website</Label>
              <Input
                value={data.website}
                onChange={(e) => handleChange('website', e.target.value)}
                disabled={!canEdit}
                placeholder="https://example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Registered Email</Label>
              <Input
                type="email"
                value={data.registered_email}
                onChange={(e) => handleChange('registered_email', e.target.value)}
                disabled={!canEdit}
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Registered Contact No</Label>
              <Input
                value={data.registered_contact_no}
                onChange={(e) => handleChange('registered_contact_no', e.target.value)}
                disabled={!canEdit}
                placeholder="1234567890"
              />
            </div>
            <div className="space-y-2">
              <Label>Fax</Label>
              <Input
                value={data.fax}
                onChange={(e) => handleChange('fax', e.target.value)}
                disabled={!canEdit}
                placeholder="Fax number"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Person Name</Label>
              <Input
                value={data.contact_person_name}
                onChange={(e) => handleChange('contact_person_name', e.target.value)}
                disabled={!canEdit}
                placeholder="Name"
              />
            </div>
            <div className="space-y-2">
              <Label>Support Person Name</Label>
              <Input
                value={data.support_person_name}
                onChange={(e) => handleChange('support_person_name', e.target.value)}
                disabled={!canEdit}
                placeholder="Name"
              />
            </div>
            <div className="space-y-2">
              <Label>Support Contact No</Label>
              <Input
                value={data.support_contact_no}
                onChange={(e) => handleChange('support_contact_no', e.target.value)}
                disabled={!canEdit}
                placeholder="+1 234 567 8900"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">Address Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2 md:col-span-2 lg:col-span-4">
              <Label>Address</Label>
              <Textarea
                value={data.address}
                onChange={(e) => handleChange('address', e.target.value)}
                disabled={!canEdit}
                placeholder="Full address"
                className="min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                value={data.city}
                onChange={(e) => handleChange('city', e.target.value)}
                disabled={!canEdit}
                placeholder="City"
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input
                value={data.state}
                onChange={(e) => handleChange('state', e.target.value)}
                disabled={!canEdit}
                placeholder="State"
              />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Input
                value={data.country}
                onChange={(e) => handleChange('country', e.target.value)}
                disabled={!canEdit}
                placeholder="Country"
              />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input
                value={data.pincode}
                onChange={(e) => handleChange('pincode', e.target.value)}
                disabled={!canEdit}
                placeholder="Pincode"
              />
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

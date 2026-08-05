'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SettingsPanelHead } from './settings-panel-head';
import { Upload, Trash2 } from 'lucide-react';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

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
  logo_url?: string;
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
  const { user, profile, accountId, isOwner, isAdmin } = useAuth();
  const supabase = createClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [data, setData] = useState<CompanyProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  const currentLogo = previewUrl ?? (!removeLogo ? data.logo_url ?? null : null);
  const initial = (data.name || profile?.full_name || 'C').charAt(0).toUpperCase();

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
        
        let loadedData = { ...DEFAULT_PROFILE };
        
        // Prefill from signup profile if settings are entirely empty
        if (!acct?.settings?.company_profile?.name && profile) {
           loadedData.name = profile.full_name || '';
           loadedData.registered_email = profile.email || '';
        }
        
        if (acct?.settings?.company_profile) {
          loadedData = { ...loadedData, ...acct.settings.company_profile };
        }
        
        setData(loadedData);
      } catch (err) {
        console.error('Failed to load company profile:', err);
        toast.error('Failed to load company profile');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [accountId, profile, supabase]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error('Unsupported image type. Use PNG, JPG, WebP, or GIF.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Image is too large. Maximum 2 MB.');
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveLogo(false);
  };

  const onRemoveLogo = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(null);
    setPreviewUrl(null);
    setRemoveLogo(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    setSaving(true);
    try {
      let nextLogoUrl = data.logo_url;

      if (pendingLogo && user) {
        const ext = pendingLogo.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${accountId}/company-logo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingLogo, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingLogo.type,
          });
        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
        
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
        nextLogoUrl = publicUrl;
      } else if (removeLogo) {
        nextLogoUrl = undefined;
      }

      const { data: acct } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', accountId)
        .single();

      const currentSettings = acct?.settings || {};
      const newSettings = {
        ...currentSettings,
        company_profile: { ...data, logo_url: nextLogoUrl },
      };

      const { error } = await supabase
        .from('accounts')
        .update({ settings: newSettings })
        .eq('id', accountId);

      if (error) throw error;
      
      setPendingLogo(null);
      setPreviewUrl(null);
      setRemoveLogo(false);
      setData(prev => ({ ...prev, logo_url: nextLogoUrl }));
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
      <form onSubmit={handleSubmit} className="mt-6 space-y-8 pb-10">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar className="h-16 w-16">
            {currentLogo ? (
              <AvatarImage src={currentLogo} alt={data.name || 'Company Logo'} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-base text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onPickFile}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving || !canEdit}
            >
              <Upload className="mr-2 h-4 w-4" />
              {currentLogo ? 'Change logo' : 'Upload logo'}
            </Button>
            {currentLogo && (
              <Button
                type="button"
                variant="ghost"
                onClick={onRemoveLogo}
                disabled={saving || !canEdit}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground mt-1">
              PNG, JPG, WebP, or GIF. Up to 2 MB.
            </p>
          </div>
        </div>

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

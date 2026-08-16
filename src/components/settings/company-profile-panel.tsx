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
import { Upload, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SettingsPanelHead } from './settings-panel-head';
import { TerritoryPicker } from '@/components/territories/territory-picker';
import { getTerritoryRows, getAccountTerritorySettings } from '@/lib/territories/api';
import type { Territory, TerritorySettings } from '@/lib/territories/types';
import { DEFAULT_TERRITORY_SETTINGS } from '@/lib/territories/settings';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface CompanyProfileData {
  name: string;
  website: string;
  registered_email: string;
  registered_contact_no: string;
  contact_person_name: string;
  address: string;
  pincode: string;
  territory_id: string | null;
  logo_url?: string;
  /**
   * Printed on documents when a template enables the GST line in its header. Added
   * 2026-08-16: the print routes had always tried to render a company GST number and no
   * field existed to hold one, so every document printed "GST No :" and nothing after it.
   */
  gst_number: string;
}

const DEFAULT_PROFILE: CompanyProfileData = {
  name: '',
  website: '',
  registered_email: '',
  registered_contact_no: '',
  contact_person_name: '',
  address: '',
  pincode: '',
  territory_id: null,
  gst_number: '',
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

  const [territoryRows, setTerritoryRows] = useState<Territory[]>([]);
  const [territorySettings, setTerritorySettings] = useState<TerritorySettings>(DEFAULT_TERRITORY_SETTINGS);

  const currentLogo = previewUrl ?? (!removeLogo ? data.logo_url ?? null : null);
  const initial = (data.name || profile?.full_name || 'C').charAt(0).toUpperCase();

  const canEdit = isOwner || isAdmin;

  useEffect(() => {
    async function loadData() {
      if (!accountId) return;
      try {
        // Fetch territory data alongside account settings
        const [acctResponse, rowsData, settingsData] = await Promise.all([
          supabase.from('accounts').select('settings').eq('id', accountId).single(),
          getTerritoryRows(accountId),
          getAccountTerritorySettings(accountId)
        ]);

        if (acctResponse.error) throw acctResponse.error;
        const acct = acctResponse.data;
        
        setTerritoryRows(rowsData);
        setTerritorySettings(settingsData);
        
        let loadedData = { ...DEFAULT_PROFILE };
        
        // Prefill from signup profile if settings are entirely empty
        if (!acct?.settings?.company_profile?.name && profile) {
           loadedData.name = profile.full_name || '';
           loadedData.registered_email = profile.email || '';
           loadedData.contact_person_name = profile.full_name || '';
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
        const path = `${user.id}/company-logo-${Date.now()}.${ext}`;
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
              <Label>Contact Person Name</Label>
              <Input
                value={data.contact_person_name}
                onChange={(e) => handleChange('contact_person_name', e.target.value)}
                disabled={!canEdit}
                placeholder="Name"
              />
            </div>
            <div className="space-y-2">
              <Label>GST Number</Label>
              <Input
                value={data.gst_number}
                onChange={(e) => handleChange('gst_number', e.target.value)}
                disabled={!canEdit}
                placeholder="22AAAAA0000A1Z5"
              />
              <p className="text-xs text-muted-foreground">
                Printed on orders, quotations, dispatches and receipts when the template
                includes the GST line.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">Address Info</h3>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
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
                <Label>Pincode</Label>
                <Input
                  value={data.pincode}
                  onChange={(e) => handleChange('pincode', e.target.value)}
                  disabled={!canEdit}
                  placeholder="Pincode"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="mb-2 block">Area / Territory</Label>
              <TerritoryPicker
                rows={territoryRows}
                settings={territorySettings}
                value={data.territory_id}
                onChange={(id) => handleChange('territory_id', id || '')}
                disabled={!canEdit}
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

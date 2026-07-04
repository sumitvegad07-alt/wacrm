'use client';

import { useMemo, Suspense, useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AISettingsPanel } from '@/components/settings/ai-settings-panel';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { BrainCircuit, Zap } from 'lucide-react';

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, hasWhatsApp, hasAdvancedAI } = useAuth();
  const { mode } = useTheme();

  const [activeTab, setActiveTab] = useState<SettingsSection>(resolveSection(searchParams.get('tab')));

  // Sync if URL changes externally (e.g. back button)
  useEffect(() => {
    setActiveTab(resolveSection(searchParams.get('tab')));
  }, [searchParams]);

  const section = activeTab;

  const go = (next: SettingsSection) => {
    setActiveTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: hasWhatsApp ? <WhatsAppConfig /> : (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
          <Zap className="h-8 w-8 text-blue-500" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">WhatsApp API not included</h2>
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          Your current plan is <strong>Basic</strong>. Upgrade to <strong>Pro</strong> or <strong>Enterprise</strong> to unlock
          the WhatsApp integration, shared team inbox, and broadcasts.
        </p>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-500">
            Contact your admin to upgrade your plan
          </div>
          <p className="text-xs text-muted-foreground">or ask your superadmin to switch you to Pro</p>
        </div>
      </div>
    ),
    ai: hasAdvancedAI ? <AISettingsPanel /> : (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
          <BrainCircuit className="h-8 w-8 text-violet-500" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">AI Module not included</h2>
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          Upgrade to <strong>Enterprise</strong> to unlock
          the full Agentic AI Assistant, knowledge base, and smart reply features.
        </p>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-500">
            <Zap className="h-4 w-4" />
            Contact your admin to upgrade to Enterprise
          </div>
        </div>
      </div>
    ),
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything in one place — your account and your workspace. Pick a
          section to manage it.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

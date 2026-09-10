'use client';

import { Suspense, useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { PasswordForm } from '@/components/settings/password-form';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DocumentTemplatesPanel } from '@/components/settings/document-templates/document-templates-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { LeadsSettings } from '@/components/settings/leads-settings';
import { TasksSettings } from '@/components/settings/tasks-settings';
import { OrdersSettings } from '@/components/settings/orders-settings';
import { PricingSchemesSettings } from '@/components/settings/pricing-schemes-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AISettingsPanel } from '@/components/settings/ai-settings-panel';
import { ExpenseTypesSettings } from '@/components/settings/expense-types-settings';
import { LeaveTypesSettings } from '@/components/settings/leave-types-settings';
import { ModuleSettingsPanel } from '@/components/settings/module-settings';
import { DealPipelinesSettings } from '@/components/settings/deal-pipelines-settings';
import { TerritoryManager } from '@/components/territories/territory-manager';
import { RouteSettings } from '@/components/settings/route-settings';
import { GeoFencingSettings } from '@/components/settings/geo-fencing-settings';
import { PaymentSettings } from '@/components/settings/payments-settings';
import {
  resolveSection,
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { Zap, ArrowLeft } from 'lucide-react';
import { Button } from "@/components/ui/button";

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasWhatsApp } = useAuth();

  const rawTab = searchParams.get('tab') || searchParams.get('section');
  const [activeTab, setActiveTab] = useState<SettingsSection>(() => {
    if (!rawTab || rawTab === 'overview') return 'module_settings';
    return resolveSection(rawTab);
  });

  // Sync when tab query parameter changes
  useEffect(() => {
    const nextTab = searchParams.get('tab') || searchParams.get('section');
    if (!nextTab || nextTab === 'overview') {
      setActiveTab('module_settings');
    } else {
      setActiveTab(resolveSection(nextTab));
    }
  }, [searchParams]);

  const section = activeTab;

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <ModuleSettingsPanel />,
    password: <PasswordForm />,
    appearance: <AppearancePanel />,
    ai: <AISettingsPanel />,
    whatsapp: hasWhatsApp ? (
      <WhatsAppConfig />
    ) : (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
          <Zap className="h-8 w-8 text-blue-500" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          WhatsApp API not included
        </h2>
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          Your current plan is <strong>Basic</strong>. Upgrade to{' '}
          <strong>Pro</strong> or <strong>Enterprise</strong> to unlock WhatsApp
          integration and shared team inbox.
        </p>
      </div>
    ),
    templates: <TemplateManager />,
    document_templates: <DocumentTemplatesPanel />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    deal_pipelines: (
      <div className="space-y-6">
        <DealsSettings />
        <DealPipelinesSettings />
      </div>
    ),
    leads: <LeadsSettings />,
    tasks: <TasksSettings />,
    orders: <OrdersSettings />,
    payments: <PaymentSettings />,
    pricing: <PricingSchemesSettings />,
    expense_types: <ExpenseTypesSettings />,
    leave_types: <LeaveTypesSettings />,
    territories: <TerritoryManager />,
    route: <RouteSettings />,
    geofencing: <GeoFencingSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
    module_settings: <ModuleSettingsPanel />,
  };

  return (
    <div className="w-full space-y-6">
      {/* Header — displays title for whichever setting is open */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {SECTION_META[section]?.label || 'Organization Settings'}
          </h1>
        </div>
      </div>

      {/* Main Panel Content — cleanly displays the active openable settings panel */}
      <div className="mt-4 min-w-0">
        {panel[section]}
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

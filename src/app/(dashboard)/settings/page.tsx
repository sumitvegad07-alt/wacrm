'use client';

import { Suspense, useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { PasswordForm } from '@/components/settings/password-form';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { NotificationPreferencesPanel } from '@/components/settings/notification-preferences-panel';
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
import { AttendanceLocationsSettings } from '@/components/settings/attendance-locations-settings';
import { PaymentSettings } from '@/components/settings/payments-settings';
import {
  resolveSection,
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { Lock, ArrowLeft } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { gatePasses } from '@/lib/plans/surface-gates';
import type { ProductLine } from '@/lib/plans/catalog';

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    hasCRM, hasWFA, hasSFA, hasFSM,
    isModuleEnabled, moduleSettingsLoaded, hasPermission,
  } = useAuth();

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
    notifications: <NotificationPreferencesPanel />,
    ai: <AISettingsPanel />,
    whatsapp: <WhatsAppConfig />,
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
    attendance_locations: <AttendanceLocationsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
    module_settings: <ModuleSettingsPanel />,
  };

  // Every panel used to render for anyone who could reach /settings: no plan
  // check and no permission check, with the section chosen by a deep-linkable
  // `?tab=` value. SECTION_META now carries both gates (see settings-sections.ts)
  // and this is where they are enforced.
  //
  // `moduleSettingsLoaded` has to be true first: payment, route, scheme, stock
  // and reporting_hierarchy all ship OFF, so judging on the defaults would
  // refuse a panel the account is entitled to on every cold load and refresh.
  const owns: Record<ProductLine, boolean> = { crm: hasCRM, wfa: hasWFA, sfa: hasSFA, fsm: hasFSM };
  const meta = SECTION_META[section];
  const blocked: 'plan' | 'permission' | null = !meta
    ? null
    : moduleSettingsLoaded && !gatePasses(meta.gate, { owns, isModuleEnabled })
      ? 'plan'
      : meta.permission && !hasPermission(meta.permission)
        ? 'permission'
        : null;

  return (
    <div className="w-full space-y-3">
      {/* The one title for whichever section is open. A panel never repeats it
          — it adds its description and its actions underneath. */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="size-7 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {SECTION_META[section]?.label || 'Organization Settings'}
        </h1>
      </div>

      <div className="min-w-0">
        {blocked ? <SectionBlocked reason={blocked} /> : panel[section]}
      </div>
    </div>
  );
}

function SectionBlocked({ reason }: { reason: 'plan' | 'permission' }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-foreground">
        {reason === 'plan' ? 'Not included in your plan' : 'You don\u2019t have access'}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {reason === 'plan'
          ? 'These settings belong to a module your subscription doesn\u2019t cover.'
          : 'Ask an admin to grant you this right in Team \u2192 Employee Roles.'}
      </p>
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

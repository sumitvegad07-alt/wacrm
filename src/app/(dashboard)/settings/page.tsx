'use client';

import { Suspense, useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { CompanyProfilePanel } from '@/components/settings/company-profile-panel';
import { SubscriptionPanel } from '@/components/settings/subscription-panel';
import { PasswordForm } from '@/components/settings/password-form';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { LeadsSettings } from '@/components/settings/leads-settings';
import { TasksSettings } from '@/components/settings/tasks-settings';
import { OrdersSettings } from '@/components/settings/orders-settings';
import { PricingSchemesSettings } from '@/components/settings/pricing-schemes-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AISettingsPanel } from '@/components/settings/ai-settings-panel';
import { ExpenseTypesSettings } from '@/components/settings/expense-types-settings';
import { ModuleSettingsPanel } from '@/components/settings/module-settings';
import { DealPipelinesSettings } from '@/components/settings/deal-pipelines-settings';
import { TerritoryManager } from '@/components/territories/territory-manager';
import { RouteSettings } from '@/components/settings/route-settings';
import {
  resolveSection,
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { Zap, AlertTriangle, ArrowRight, ArrowLeft, MapPin } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

  const [manageState, setManageState] = useState<'overview' | 'downgrade'>('overview');

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
    company_profile: <CompanyProfilePanel />,
    subscription: <SubscriptionPanel />,
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
    pricing: <PricingSchemesSettings />,
    expense_types: <ExpenseTypesSettings />,
    territories: <TerritoryManager />,
    route: <RouteSettings />,
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

        {/* Downgrade/Cancel Modal */}
        <Dialog onOpenChange={(open) => !open && setTimeout(() => setManageState('overview'), 200)}>
          <DialogTrigger render={<Button variant="outline" className="text-muted-foreground shrink-0" />}>
            Manage Plan
          </DialogTrigger>
          <DialogContent className="max-w-md">
            {manageState === 'overview' ? (
              <>
                <DialogHeader>
                  <DialogTitle>Your Subscription</DialogTitle>
                  <DialogDescription>
                    Manage your base plan and add-ons.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-2">
                  <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-foreground">Pro Plan</span>
                      <span className="font-bold text-blue-500">₹200/mo</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Includes WhatsApp Integration, Automations, and Core CRM.</p>
                    <Button variant="outline" size="sm" className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => setManageState('downgrade')}>
                      Cancel / Downgrade
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-foreground flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Location Tracking Add-on</span>
                      <span className="font-bold text-foreground">₹50/mo</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Track field sales staff and visits in real-time. (Requires Pro plan or higher)</p>
                    <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                      Add to Plan
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" /> Cancel Subscription?
                  </DialogTitle>
                  <DialogDescription>
                    If you downgrade to the Free plan, you will lose access to several premium features immediately:
                  </DialogDescription>
                </DialogHeader>
                <div className="py-3">
                  <ul className="space-y-2.5 text-sm">
                    <li className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-destructive">
                        <span className="text-xs font-bold">✕</span>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">WhatsApp API Integration</span>
                        <p className="text-xs text-muted-foreground">Team inbox, templates, and automated message workflows will stop working.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-destructive">
                        <span className="text-xs font-bold">✕</span>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Live GPS Staff Tracking</span>
                        <p className="text-xs text-muted-foreground">Real-time attendance and field check-in monitoring will be disabled.</p>
                      </div>
                    </li>
                  </ul>
                  <div className="mt-6 rounded-lg bg-muted p-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      Are you sure you want to give up these features? Over <strong>85% of businesses</strong> see a drop in lead response times after downgrading.
                    </p>
                    <Button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold" onClick={() => setManageState('overview')}>
                      Keep My Plan <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
                <DialogFooter className="sm:justify-center">
                  <Button variant="ghost" className="text-muted-foreground text-xs hover:text-destructive">
                    Yes, downgrade and lose features
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
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

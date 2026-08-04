'use client';

import { Suspense, useState, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { LeadsSettings } from '@/components/settings/leads-settings';
import { TasksSettings } from '@/components/settings/tasks-settings';
import { OrdersSettings } from '@/components/settings/orders-settings';
import { PricingSchemesSettings } from '@/components/settings/pricing-schemes-settings';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { ExpenseTypesSettings } from '@/components/settings/expense-types-settings';
import { ModuleSettingsPanel } from '@/components/settings/module-settings';
import { DealPipelinesSettings } from '@/components/settings/deal-pipelines-settings';
import { TerritoryManager } from '@/components/territories/territory-manager';
import { RouteSettings } from '@/components/settings/route-settings';
import {
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { Zap, AlertTriangle, ArrowRight, MapPin, Check } from 'lucide-react';
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
import { cn } from "@/lib/utils";

// All settings sections in logical organization order
const SCROLLABLE_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'module_settings', label: 'Organization Settings' },
  { id: 'profile', label: 'Profile & Appearance' },
  { id: 'security', label: 'Login & Security' },
  { id: 'whatsapp', label: 'WhatsApp Configuration' },
  { id: 'fields', label: 'Custom Fields & Tags' },
  { id: 'deal_pipelines', label: 'Deals & Pipelines' },
  { id: 'leads', label: 'Leads Settings' },
  { id: 'tasks', label: 'Task Settings' },
  { id: 'orders', label: 'Orders Settings' },
  { id: 'pricing', label: 'Catalogue Settings' },
  { id: 'expense_types', label: 'Expense Settings' },
  { id: 'territories', label: 'Territory Master' },
  { id: 'route', label: 'Route Settings' },
  { id: 'api', label: 'API Keys & Webhooks' },
];

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasWhatsApp } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingsSection>('module_settings');
  const [manageState, setManageState] = useState<'overview' | 'downgrade'>('overview');

  // Smooth scroll to section when tab param changes or on initial load
  useEffect(() => {
    const tab = searchParams.get('tab') || searchParams.get('section') || 'module_settings';
    if (tab) {
      setActiveSection(tab as SettingsSection);
      const el = document.getElementById(tab);
      if (el) {
        // Delay slightly for DOM hydration
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    }
  }, [searchParams]);

  const jumpTo = (id: SettingsSection) => {
    setActiveSection(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', id);
    params.delete('section');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="w-full space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings / Organization Configuration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your active CRM modules, workspace configurations, and account settings all in one scrollable menu.
          </p>
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

      {/* Sticky Quick-Jump Navigation Bar */}
      <div className="sticky top-0 z-20 flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background/95 py-2.5 backdrop-blur-md no-scrollbar">
        {SCROLLABLE_SECTIONS.map(({ id, label }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => jumpTo(id)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── ALL SETTINGS IN ONE SCROLLABLE MENU OF SETTINGS ── */}
      <div className="space-y-12">
        {/* 1. Organization Settings (Modules / System config) */}
        <div id="module_settings" className="scroll-mt-24 space-y-4">
          <ModuleSettingsPanel />
        </div>

        {/* 2. Profile & Appearance */}
        <div id="profile" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Profile & Appearance</h2>
            <p className="text-sm text-muted-foreground">Manage your personal details, email, and display theme.</p>
          </div>
          <ProfileForm />
          <AppearancePanel />
        </div>

        {/* 3. Login & Security */}
        <div id="security" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Login & Security</h2>
            <p className="text-sm text-muted-foreground">Update password, authentication methods, and security settings.</p>
          </div>
          <SecurityPanel />
        </div>

        {/* 4. WhatsApp Configuration */}
        <div id="whatsapp" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">WhatsApp Configuration</h2>
            <p className="text-sm text-muted-foreground">Configure WhatsApp Business API, messaging templates, and inbox.</p>
          </div>
          {hasWhatsApp ? (
            <WhatsAppConfig />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
                <Zap className="h-8 w-8 text-blue-500" />
              </div>
              <h2 className="mb-2 text-xl font-semibold text-foreground">WhatsApp API not included</h2>
              <p className="mb-6 max-w-sm text-sm text-muted-foreground">
                Your current plan is <strong>Basic</strong>. Upgrade to <strong>Pro</strong> or <strong>Enterprise</strong> to unlock WhatsApp integration and shared team inbox.
              </p>
            </div>
          )}
        </div>

        {/* 5. Custom Fields & Tags */}
        <div id="fields" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Custom Fields & Tags</h2>
            <p className="text-sm text-muted-foreground">Create and manage custom data attributes and tags for your records.</p>
          </div>
          <FieldsAndTagsPanel />
        </div>

        {/* 6. Deals & Pipelines */}
        <div id="deal_pipelines" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Deals & Pipelines</h2>
            <p className="text-sm text-muted-foreground">Configure sales pipelines, stages, and currency rules.</p>
          </div>
          <DealsSettings />
          <DealPipelinesSettings />
        </div>

        {/* 7. Leads Settings */}
        <div id="leads" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Leads Settings</h2>
            <p className="text-sm text-muted-foreground">Manage lead sources, default statuses, and assignment rules.</p>
          </div>
          <LeadsSettings />
        </div>

        {/* 8. Task Settings */}
        <div id="tasks" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Task Settings</h2>
            <p className="text-sm text-muted-foreground">Customize task categories, priorities, and workflow rules.</p>
          </div>
          <TasksSettings />
        </div>

        {/* 9. Orders Settings */}
        <div id="orders" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Orders Settings</h2>
            <p className="text-sm text-muted-foreground">Configure order numbering, prefixes, and fulfillment workflows.</p>
          </div>
          <OrdersSettings />
        </div>

        {/* 10. Catalogue Settings */}
        <div id="pricing" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Catalogue Settings</h2>
            <p className="text-sm text-muted-foreground">Manage pricing schemes, product discounts, and catalogue rules.</p>
          </div>
          <PricingSchemesSettings />
        </div>

        {/* 11. Expense Settings */}
        <div id="expense_types" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Expense Settings</h2>
            <p className="text-sm text-muted-foreground">Define expense categories, approval rules, and reporting policies.</p>
          </div>
          <ExpenseTypesSettings />
        </div>

        {/* 12. Territory Master */}
        <div id="territories" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Territory Master</h2>
            <p className="text-sm text-muted-foreground">Configure geographic hierarchy, employee areas, and territory levels.</p>
          </div>
          <TerritoryManager />
        </div>

        {/* 13. Route Settings */}
        <div id="route" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">Route Settings</h2>
            <p className="text-sm text-muted-foreground">Manage beat routes, travel rules, and salesman assignment policies.</p>
          </div>
          <RouteSettings />
        </div>

        {/* 14. API Keys & Webhooks */}
        <div id="api" className="scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
          <div className="border-b border-border/80 pb-3">
            <h2 className="text-lg font-semibold text-foreground">API Keys & Webhooks</h2>
            <p className="text-sm text-muted-foreground">Generate developer API tokens and configure real-time webhooks.</p>
          </div>
          <ApiKeysSettings />
        </div>
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

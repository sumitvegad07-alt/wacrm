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
import { LeadsSettings } from '@/components/settings/leads-settings';
import { TasksSettings } from '@/components/settings/tasks-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AISettingsPanel } from '@/components/settings/ai-settings-panel';
import { ExpenseTypesSettings } from '@/components/settings/expense-types-settings';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { BrainCircuit, Zap, Sparkles, AlertTriangle, ArrowRight, MapPin } from 'lucide-react';
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
  const { defaultCurrency, hasWhatsApp, hasAdvancedAI } = useAuth();
  const { mode } = useTheme();

  const [activeTab, setActiveTab] = useState<SettingsSection>(resolveSection(searchParams.get('tab')));

  const [manageState, setManageState] = useState<'overview' | 'downgrade'>('overview');

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
          <button 
            onClick={() => alert("Simulating AI Reply:\n\nUser: What are your working hours?\nwaCRM AI: Hi! We are open Monday to Friday from 9 AM to 6 PM. How can I help you today?")}
            className="flex items-center gap-2 rounded-lg bg-violet-500 text-white px-4 py-2 text-sm font-medium hover:bg-violet-600 transition-all shadow-sm"
          >
            <Sparkles className="h-4 w-4" /> Preview AI Reply
          </button>
          <div className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-500 mt-2">
            <Zap className="h-4 w-4" />
            Contact your admin to upgrade to Enterprise
          </div>
        </div>
      </div>
    ),
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    leads: <LeadsSettings />,
    tasks: <TasksSettings />,
    expense_types: <ExpenseTypesSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything in one place — your account and your workspace. Pick a
            section to manage it.
          </p>
        </div>

        {/* Downgrade/Cancel Modal */}
        <Dialog onOpenChange={(open) => !open && setTimeout(() => setManageState('overview'), 200)}>
          <DialogTrigger render={<Button variant="outline" className="text-muted-foreground" />}>
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
                <div className="py-4">
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3 text-sm text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive font-bold text-xs">X</span>
                      <span><strong>AI Auto-Replies</strong> will be disabled.</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive font-bold text-xs">X</span>
                      <span><strong>Shared Team Inbox</strong> will lock for 3+ members.</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive font-bold text-xs">X</span>
                      <span><strong>Advanced Automations</strong> will stop running.</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive font-bold text-xs">X</span>
                      <span>Your <strong>WhatsApp API integration</strong> will be disconnected.</span>
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

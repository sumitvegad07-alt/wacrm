'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { CustomFieldsModuleBuilder } from '@/components/custom-fields/custom-fields-module-builder';
import { RequirePermission } from '@/components/auth/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { gatePasses, CUSTOM_FIELD_GATES } from '@/lib/plans/surface-gates';
import type { ProductLine } from '@/lib/plans/catalog';

export default function CustomFieldsModulePage() {
  const params = useParams();
  const moduleName = (typeof params.module === 'string' ? params.module : params.module?.[0]) || 'contact';
  const { hasCRM, hasWFA, hasSFA, hasFSM, isModuleEnabled, moduleSettingsLoaded } = useAuth();

  // Plan ceiling. Custom Fields had no plan gating at all, so a WFA-only tenant
  // was handed the Sale Quotation, Lead, Deal, Order and Dispatch field
  // builders, and a CRM-only tenant the Order, Dispatch, Customer Visit and
  // Expense ones — all configuration for modules those plans cannot open.
  // Owner and admin get no bypass.
  //
  // Waits for moduleSettingsLoaded: several of these ride a module toggle that
  // ships off, and judging on the defaults would refuse a page the account is
  // entitled to on every cold load and refresh.
  const owns: Record<ProductLine, boolean> = { crm: hasCRM, wfa: hasWFA, sfa: hasSFA, fsm: hasFSM };
  const offPlan =
    moduleSettingsLoaded &&
    !gatePasses(CUSTOM_FIELD_GATES[moduleName], { owns, isModuleEnabled });

  if (offPlan) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Not included in your plan</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            This module isn&apos;t part of your subscription, so there are no fields
            to configure for it. Pick another module from Custom Fields in the menu.
          </p>
        </div>
      </div>
    );
  }

  return (
    <RequirePermission permission="edit_custom_fields">
      <CustomFieldsModuleBuilder moduleName={moduleName} />
    </RequirePermission>
  );
}

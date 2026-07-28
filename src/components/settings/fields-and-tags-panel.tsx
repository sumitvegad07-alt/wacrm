'use client';

import { useCan } from '@/hooks/use-can';

import { CustomFieldsSettings } from './custom-fields-settings';
import { SettingsPanelHead } from './settings-panel-head';
import { TagManager } from './tag-manager';

/**
 * "Fields & tags" section — merges the former Tags and Custom Fields
 * tabs. Tags are visible to everyone; the custom-fields catalogue is
 * account-wide config, so the card is admin-gated (mirroring the old
 * hidden-tab behaviour). `custom_fields` RLS rejects non-admin writes
 * regardless.
 */
export function FieldsAndTagsPanel() {
  const canEditSettings = useCan('edit-settings');

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Custom fields & tags"
        description="Two ways to organize contacts: colour-coded tags for quick grouping, and custom fields for structured data."
      />
      <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <TagManager />
        {canEditSettings ? (
          <CustomFieldsSettings />
        ) : (
          <div className="p-5 border border-border rounded-lg bg-card space-y-3">
            <h3 className="font-semibold text-sm text-foreground">Custom Fields</h3>
            <p className="text-xs text-muted-foreground">
              Custom fields allow structured data collection across contacts and leads. Only workspace admins can add or modify custom fields.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

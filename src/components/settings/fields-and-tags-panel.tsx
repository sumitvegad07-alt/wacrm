'use client';

import { SettingsPanel } from '@/components/settings/settings-layout';
import { TagManager } from './tag-manager';

/**
 * "Tags" section — tags for quick grouping and organizing contacts.
 * Custom Fields have been moved to their own full-screen builder in the main sidebar menu.
 */
export function FieldsAndTagsPanel() {
  return (
    <SettingsPanel
      description="Organize contacts with colour-coded tags for quick grouping. Custom fields and sections are now managed from the 'Custom Fields' menu in the sidebar."
      className="animate-in fade-in-50 duration-200"
    >
      <div className="grid grid-cols-1 gap-6 items-start">
        <TagManager />
      </div>
    </SettingsPanel>
  );
}

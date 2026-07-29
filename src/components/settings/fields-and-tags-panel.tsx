'use client';

import { SettingsPanelHead } from './settings-panel-head';
import { TagManager } from './tag-manager';

/**
 * "Tags" section — tags for quick grouping and organizing contacts.
 * Custom Fields have been moved to their own full-screen builder in the main sidebar menu.
 */
export function FieldsAndTagsPanel() {
  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Contact tags"
        description="Organize contacts with colour-coded tags for quick grouping. Custom fields and sections are now managed from the 'Custom Fields' menu in the sidebar."
      />
      <div className="mt-6 grid grid-cols-1 gap-6 items-start">
        <TagManager />
      </div>
    </section>
  );
}

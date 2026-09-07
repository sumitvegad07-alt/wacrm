'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Label } from '@/components/ui/label';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
import type { CustomField, CustomFieldSection } from '@/types';

interface CustomFieldsSectionRendererProps {
  accountId?: string | null;
  moduleName: string;
  customFields: CustomField[];
  customValues: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
  formData?: Record<string, any>;
  onFormDataChange?: (key: string, value: any) => void;
  renderCustomSystemField?: (field: CustomField) => React.ReactNode | null | undefined;
  isEditing?: boolean;
}

export function CustomFieldsSectionRenderer({
  accountId,
  moduleName,
  customFields,
  customValues,
  onChange,
  formData,
  onFormDataChange,
  renderCustomSystemField,
  isEditing = true,
}: CustomFieldsSectionRendererProps) {
  const [sections, setSections] = useState<CustomFieldSection[]>([]);
  const [sectionsLoaded, setSectionsLoaded] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let active = true;
    async function loadSections() {
      if (!accountId) return;
      try {
        const { data } = await supabase
          .from('custom_field_sections')
          .select('*')
          .eq('account_id', accountId)
          .eq('module_name', moduleName)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });

        if (active) {
          if (data) setSections(data as CustomFieldSection[]);
          setSectionsLoaded(true);
        }
      } catch (err) {
        console.error('Failed loading custom field sections:', err);
        if (active) setSectionsLoaded(true);
      }
    }
    loadSections();
    return () => {
      active = false;
    };
  }, [accountId, moduleName, supabase]);

  // Filter only active custom fields
  const activeFields = customFields.filter((f) => f.is_active !== false);
  if (activeFields.length === 0) return null;

  // Wait for the section fetch to resolve before painting. Without this the
  // first render (sections = []) collapses every field into one synthesized
  // section sorted by per-section position, which briefly mis-orders the form
  // (Address/Territory fields flashing before Primary Details) until the real
  // sections arrive. Render a stable-height skeleton meanwhile to avoid a jump.
  if (!sectionsLoaded) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: Math.min(activeFields.length, 6) }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              <div className="h-9 w-full rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // If we don't have sections yet, synthesize a default one for display
  const displaySections: { id: string; name: string; position: number }[] =
    sections.length > 0
      ? sections
      : [{ id: 'default', name: 'General Details', position: 0 }];

  // Map each active field to a section
  const fieldsBySectionId = new Map<string, CustomField[]>();

  for (const field of activeFields) {
    let targetId = field.section_id;
    if (!targetId || !displaySections.some((s) => s.id === targetId)) {
      targetId = displaySections[0].id;
    }
    const arr = fieldsBySectionId.get(targetId) || [];
    arr.push(field);
    fieldsBySectionId.set(targetId, arr);
  }

  // Sort fields within each section by position
  for (const [secId, arr] of fieldsBySectionId.entries()) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  return (
    <div className="space-y-6">
      {displaySections.map((sec) => {
        const sectionFields = fieldsBySectionId.get(sec.id) || [];
        if (sectionFields.length === 0) return null;

        return (
          <div key={sec.id} className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">
              {sec.name}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map((field) => {
                const customNode = renderCustomSystemField ? renderCustomSystemField(field) : undefined;
                if (customNode === null) return null; // Component explicitly requested to be hidden
                
                const isSystem = Boolean(field.system_key);
                const value = isSystem && formData && field.system_key
                  ? formData[field.system_key] ?? ''
                  : customValues[field.id] ?? '';

                const handleChange = (val: string) => {
                  if (isSystem && onFormDataChange && field.system_key) {
                    onFormDataChange(field.system_key, val);
                  } else {
                    onChange(field.id, val);
                  }
                };

                return (
                  <div key={field.id} className="space-y-2">
                    <Label className="text-muted-foreground capitalize flex items-center gap-1">
                      {field.field_name}
                      {field.is_required && (
                        <span className="text-destructive font-bold">*</span>
                      )}
                    </Label>
                    {customNode !== undefined ? (
                      customNode
                    ) : isEditing === false ? (
                      <p className="font-medium text-foreground text-base">
                        {value || "—"}
                      </p>
                    ) : (
                      <CustomFieldInput
                        field={field}
                        value={value}
                        onChange={handleChange}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

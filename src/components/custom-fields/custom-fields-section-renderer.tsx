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
  /**
   * Tailwind grid classes for the field grid inside each section. Defaults to a
   * 2-column layout that stays safe inside narrow dialogs. Full-page ("as page")
   * forms pass a wider grid (e.g. up to 4 columns) to use the horizontal space
   * like the reference SFA product and cut down on scrolling.
   */
  fieldGridClassName?: string;
}

const DEFAULT_FIELD_GRID = "grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4";

/**
 * The canonical field grid for full-page create/edit forms. Every "as page"
 * form uses this exact grid so field widths, columns and row spacing are
 * identical across modules. Dialogs fall back to DEFAULT_FIELD_GRID (2-col) so
 * they don't cram 4 columns into a narrow popup.
 */
export const PAGE_FIELD_GRID =
  "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4";

/**
 * The one section-header style shared by the renderer, FormSection and every
 * hand-built section, so a form never mixes three different header looks.
 */
export const SECTION_HEADER_CLASS =
  "text-sm font-semibold text-foreground border-b border-border pb-1.5";

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
  fieldGridClassName = DEFAULT_FIELD_GRID,
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
      <div className="space-y-4" aria-hidden="true">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className={fieldGridClassName}>
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
    <div className="space-y-4">
      {displaySections.map((sec) => {
        const sectionFields = fieldsBySectionId.get(sec.id) || [];
        if (sectionFields.length === 0) return null;

        return (
          <div key={sec.id} className="space-y-3">
            <h4 className={SECTION_HEADER_CLASS}>
              {sec.name}
            </h4>
            <div className={fieldGridClassName}>
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
                  <div key={field.id} className="space-y-1.5">
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

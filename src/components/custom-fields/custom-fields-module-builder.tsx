'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  ChevronLeft,
  HelpCircle,
  Plus,
  Edit2,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Check,
  X,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { CustomField, CustomFieldSection } from '@/types';
import { ensureDefaultSectionsAndFields } from '@/lib/custom-fields';

interface CustomFieldsModuleBuilderProps {
  moduleName: string;
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  user: 'User',
  contact: 'Customer',
  product: 'Product',
  quotation: 'sale quotation',
  lead: 'Lead',
  deal: 'Deal',
  customer_visit: 'Customer visit',
  lead_visit: 'Lead visit',
  order: 'Order',
  dispatch: 'Dispatch',
  expense: 'Expense',
};

const FIELD_TYPES = [
  { value: 'text', label: 'Single-line Text' },
  { value: 'textarea', label: 'Multi-line Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown Select' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'multi-select', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox (Yes / No)' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'attachment', label: 'Attachment (File Upload)' },
  { value: 'camera', label: 'Camera (Photo / Image)' },
];

export function CustomFieldsModuleBuilder({ moduleName }: CustomFieldsModuleBuilderProps) {
  const router = useRouter();
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [savingPriority, setSavingPriority] = useState(false);

  // Data state
  const [sections, setSections] = useState<CustomFieldSection[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // Modal states
  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<CustomFieldSection | null>(null);
  const [sectionNameInput, setSectionNameInput] = useState('');

  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [fieldNameInput, setFieldNameInput] = useState('');
  const [fieldTypeInput, setFieldTypeInput] = useState('text');
  const [fieldSectionInput, setFieldSectionInput] = useState<string>('');
  const [fieldSourceType, setFieldSourceType] = useState<'static' | 'module'>('static');
  const [fieldSourceModule, setFieldSourceModule] = useState<string>('product');
  const [fieldChoices, setFieldChoices] = useState<string[]>(['']);
  const [fieldIsRequired, setFieldIsRequired] = useState(false);
  const [fieldShowInTable, setFieldShowInTable] = useState(true);
  const [fieldIsSortable, setFieldIsSortable] = useState(true);
  const [fieldIsSearchable, setFieldIsSearchable] = useState(true);
  const [fieldIsFilterable, setFieldIsFilterable] = useState(true);

  const [optionsModalOpen, setOptionsModalOpen] = useState(false);
  const [optionsField, setOptionsField] = useState<CustomField | null>(null);
  const [optionsList, setOptionsList] = useState<string[]>(['']);
  const [optionsSourceType, setOptionsSourceType] = useState<'static' | 'module'>('static');
  const [optionsSourceModule, setOptionsSourceModule] = useState<string>('product');

  const friendlyName = MODULE_DISPLAY_NAMES[moduleName] || moduleName;

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      if (user?.id) {
        await ensureDefaultSectionsAndFields(accountId, moduleName, user.id, supabase);
      }
      // Fetch sections for this module
      const { data: secData, error: secErr } = await supabase
        .from('custom_field_sections')
        .select('*')
        .eq('account_id', accountId)
        .eq('module_name', moduleName)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (secErr) throw secErr;

      let loadedSections = (secData as CustomFieldSection[] | null) || [];

      // If no sections exist for this module, create a default "General Details" section
      if (loadedSections.length === 0) {
        const { data: defaultSec, error: insErr } = await supabase
          .from('custom_field_sections')
          .insert({
            account_id: accountId,
            module_name: moduleName,
            name: 'General Details',
            position: 0,
          })
          .select()
          .single();

        if (!insErr && defaultSec) {
          loadedSections = [defaultSec as CustomFieldSection];
        }
      }

      setSections(loadedSections);
      if (loadedSections.length > 0 && !activeSectionId) {
        setActiveSectionId(loadedSections[0].id);
      }

      // Fetch fields for this module
      const { data: fldData, error: fldErr } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('account_id', accountId)
        .eq('module_name', moduleName)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (fldErr) throw fldErr;

      const loadedFields = (fldData as CustomField[] | null) || [];
      setFields(loadedFields);
    } catch (err: any) {
      console.error('Failed to fetch custom fields/sections:', err);
      toast.error('Failed to load custom sections and fields');
    } finally {
      setLoading(false);
    }
  }, [accountId, moduleName, supabase, activeSectionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Section Actions ──────────────────────────────────────────
  const handleOpenSectionModal = (sec?: CustomFieldSection) => {
    if (sec) {
      setEditingSection(sec);
      setSectionNameInput(sec.name);
    } else {
      setEditingSection(null);
      setSectionNameInput('');
    }
    setSectionModalOpen(true);
  };

  const handleSaveSection = async () => {
    if (!accountId || !sectionNameInput.trim()) return;
    try {
      if (editingSection) {
        const { error } = await supabase
          .from('custom_field_sections')
          .update({ name: sectionNameInput.trim() })
          .eq('id', editingSection.id);
        if (error) throw error;
        toast.success('Section updated');
      } else {
        const nextPos = sections.length;
        const { data, error } = await supabase
          .from('custom_field_sections')
          .insert({
            account_id: accountId,
            module_name: moduleName,
            name: sectionNameInput.trim(),
            position: nextPos,
          })
          .select()
          .single();
        if (error) throw error;
        toast.success('Section added');
        if (data && !activeSectionId) {
          setActiveSectionId((data as CustomFieldSection).id);
        }
      }
      setSectionModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save section');
    }
  };

  const handleToggleSectionStatus = async (sec: CustomFieldSection) => {
    if (sec.is_active !== false && sections.filter((s) => s.is_active !== false).length <= 1) {
      toast.error('You must keep at least one active section');
      return;
    }
    const newStatus = !(sec.is_active !== false);
    setSections((prev) =>
      prev.map((s) => (s.id === sec.id ? { ...s, is_active: newStatus } : s))
    );
    try {
      const { error } = await supabase
        .from('custom_field_sections')
        .update({ is_active: newStatus })
        .eq('id', sec.id);
      if (error) throw error;
      toast.success(newStatus ? 'Section activated' : 'Section deactivated');
    } catch (err: any) {
      toast.error('Failed to update section status');
      fetchData();
    }
  };

  // ── Field Actions ─────────────────────────────────────────────
  const handleOpenFieldModal = (fld?: CustomField) => {
    if (fld) {
      setEditingField(fld);
      setFieldNameInput(fld.field_name);
      setFieldTypeInput(fld.field_type);
      setFieldSectionInput(fld.section_id || activeSectionId || (sections[0]?.id ?? ''));
      setFieldSourceType(fld.source_type || 'static');
      setFieldSourceModule(fld.source_module || 'product');
      const existingChoices = (fld.field_options?.choices as string[]) || [];
      setFieldChoices(existingChoices.length > 0 ? existingChoices : ['']);
      setFieldIsRequired(fld.is_required ?? false);
      setFieldShowInTable(fld.show_in_table ?? true);
      setFieldIsSortable(fld.is_sortable ?? true);
      setFieldIsSearchable(fld.is_searchable ?? true);
      setFieldIsFilterable(fld.is_filterable ?? true);
    } else {
      setEditingField(null);
      setFieldNameInput('');
      setFieldTypeInput('text');
      setFieldSectionInput(activeSectionId || (sections[0]?.id ?? ''));
      setFieldSourceType('static');
      setFieldSourceModule('product');
      setFieldChoices(['']);
      setFieldIsRequired(false);
      setFieldShowInTable(true);
      setFieldIsSortable(true);
      setFieldIsSearchable(true);
      setFieldIsFilterable(true);
    }
    setFieldModalOpen(true);
  };

  const handleSaveField = async () => {
    if (!accountId || !fieldNameInput.trim()) {
      toast.error('Field name is required');
      return;
    }
    const targetSectionId = fieldSectionInput || activeSectionId || sections[0]?.id;
    const isChoice = ['dropdown', 'radio', 'multi-select'].includes(fieldTypeInput);
    const cleanChoices = isChoice && fieldSourceType === 'static' ? fieldChoices.map(c => c.trim()).filter(Boolean) : [];
    try {
      if (editingField) {
        const { error } = await supabase
          .from('custom_fields')
          .update({
            field_name: fieldNameInput.trim(),
            field_type: fieldTypeInput,
            section_id: targetSectionId,
            source_type: isChoice ? fieldSourceType : 'static',
            source_module: (isChoice && fieldSourceType === 'module') ? fieldSourceModule : null,
            field_options: isChoice && fieldSourceType === 'static' ? { choices: cleanChoices } : {},
            is_required: fieldIsRequired,
            show_in_table: fieldShowInTable,
            is_sortable: fieldIsSortable,
            is_searchable: fieldIsSearchable,
            is_filterable: fieldIsFilterable,
          })
          .eq('id', editingField.id);
        if (error) throw error;
        toast.success('Field updated');
      } else {
        const sectionFields = fields.filter((f) => f.section_id === targetSectionId);
        const userId = user?.id || (await supabase.auth.getUser()).data.user?.id;
        const { error } = await supabase.from('custom_fields').insert({
          account_id: accountId,
          user_id: userId,
          module_name: moduleName,
          field_name: fieldNameInput.trim(),
          field_type: fieldTypeInput,
          section_id: targetSectionId,
          position: sectionFields.length,
          is_active: true,
          source_type: isChoice ? fieldSourceType : 'static',
          source_module: (isChoice && fieldSourceType === 'module') ? fieldSourceModule : null,
          field_options: isChoice && fieldSourceType === 'static' ? { choices: cleanChoices } : {},
          is_required: fieldIsRequired,
          show_in_table: fieldShowInTable,
          is_sortable: fieldIsSortable,
          is_searchable: fieldIsSearchable,
          is_filterable: fieldIsFilterable,
        });
        if (error) throw error;
        toast.success('Field added');
      }
      setFieldModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save field');
    }
  };

  const handleToggleFieldStatus = async (fld: CustomField) => {
    const newStatus = !(fld.is_active !== false);
    setFields((prev) =>
      prev.map((f) => (f.id === fld.id ? { ...f, is_active: newStatus } : f))
    );
    try {
      const { error } = await supabase
        .from('custom_fields')
        .update({ is_active: newStatus })
        .eq('id', fld.id);
      if (error) throw error;
      toast.success(newStatus ? 'Field activated' : 'Field deactivated');
    } catch (err: any) {
      toast.error('Failed to update status');
      fetchData();
    }
  };

  // ── Options Actions (for dropdown, radio, multi-select) ────────
  const handleOpenOptionsModal = (fld: CustomField) => {
    setOptionsField(fld);
    setOptionsSourceType(fld.source_type || 'static');
    setOptionsSourceModule(fld.source_module || 'product');
    const existingChoices = (fld.field_options?.choices as string[]) || [];
    setOptionsList(existingChoices.length > 0 ? existingChoices : ['']);
    setOptionsModalOpen(true);
  };

  const handleSaveOptions = async () => {
    if (!optionsField) return;
    const cleanChoices = optionsSourceType === 'static' ? optionsList.map((c) => c.trim()).filter(Boolean) : [];
    try {
      const { error } = await supabase
        .from('custom_fields')
        .update({
          source_type: optionsSourceType,
          source_module: optionsSourceType === 'module' ? optionsSourceModule : null,
          field_options: optionsSourceType === 'static' ? { choices: cleanChoices } : {},
        })
        .eq('id', optionsField.id);
      if (error) throw error;
      toast.success('Options saved');
      setOptionsModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save options');
    }
  };

  // ── Priority & Ordering Actions ───────────────────────────────
  const moveSection = (idx: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sections.length) return;

    const newSections = [...sections];
    const temp = newSections[idx];
    newSections[idx] = newSections[targetIdx];
    newSections[targetIdx] = temp;
    setSections(newSections);
  };

  const moveField = (idx: number, direction: 'up' | 'down') => {
    const activeSectionFields = fields.filter((f) => f.section_id === activeSectionId);
    const otherFields = fields.filter((f) => f.section_id !== activeSectionId);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= activeSectionFields.length) return;

    const newActiveFields = [...activeSectionFields];
    const temp = newActiveFields[idx];
    newActiveFields[idx] = newActiveFields[targetIdx];
    newActiveFields[targetIdx] = temp;
    setFields([...otherFields, ...newActiveFields]);
  };

  const handleSavePriority = async () => {
    setSavingPriority(true);
    try {
      // Save sections priority
      const secUpdates = sections.map((sec, idx) =>
        supabase.from('custom_field_sections').update({ position: idx }).eq('id', sec.id)
      );
      // Save fields priority for all fields
      const activeSectionFields = fields.filter((f) => f.section_id === activeSectionId);
      const otherFields = fields.filter((f) => f.section_id !== activeSectionId);
      const allOrderedFields = [...activeSectionFields, ...otherFields];

      const fldUpdates = allOrderedFields.map((fld, idx) =>
        supabase.from('custom_fields').update({ position: idx }).eq('id', fld.id)
      );

      await Promise.all([...secUpdates, ...fldUpdates]);
      toast.success('Priority order saved successfully');
    } catch (err: any) {
      console.error('Save priority error:', err);
      toast.error('Failed to save priority order');
    } finally {
      setSavingPriority(false);
    }
  };

  const currentSectionFields = fields.filter(
    (f) => f.section_id === activeSectionId || (!f.section_id && activeSectionId === sections[0]?.id)
  );
  const isProtectedRequired = 
    moduleName === 'user' && 
    editingField?.system_key && 
    ['full_name', 'employee_role_id', 'email', 'password', 'repassword'].includes(editingField.system_key);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-card border-b border-border shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-full hover:bg-muted"
            onClick={() => router.back()}
          >
            <ChevronLeft className="size-5 text-foreground" />
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground capitalize">
              Custom Field for {friendlyName}
            </h1>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="inline-flex">
                  <HelpCircle className="size-4 text-muted-foreground cursor-pointer" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">
                    Create custom sections and fields for {friendlyName}. Use arrows to reorder priority, and save when finished.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Button
          onClick={handleSavePriority}
          disabled={savingPriority || loading}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-5 shadow-sm"
        >
          {savingPriority ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              SAVING...
            </>
          ) : (
            'SAVE PRIORITY'
          )}
        </Button>
      </header>

      {/* Main 2-Column Builder Area */}
      <main className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Sections (w-1/3 on desktop) */}
            <div className="lg:col-span-4 bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                <div>
                  <h2 className="font-bold text-base text-foreground">Section</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Drag section to set priority.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleOpenSectionModal()}
                  className="bg-secondary/70 hover:bg-secondary text-secondary-foreground text-xs font-semibold tracking-wider uppercase"
                >
                  ADD SECTION
                </Button>
              </div>

              <div className="divide-y divide-border/60 max-h-[calc(100vh-250px)] overflow-y-auto">
                {sections.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No sections defined yet.
                  </div>
                ) : (
                  sections.map((sec, idx) => {
                    const isSelected = sec.id === activeSectionId;
                    return (
                      <div
                        key={sec.id}
                        onClick={() => setActiveSectionId(sec.id)}
                        className={`flex items-center justify-between px-4 py-3.5 transition-colors cursor-pointer select-none ${
                          isSelected
                            ? 'bg-primary/10 border-l-4 border-l-primary text-primary font-semibold'
                            : 'hover:bg-muted/50 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <GripVertical className="size-4 text-muted-foreground/50 shrink-0" />
                          <span className="text-sm truncate">{sec.name}</span>
                          <Badge
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSectionStatus(sec);
                            }}
                            className={`border-0 text-[10px] px-1.5 py-0 cursor-pointer select-none transition-opacity hover:opacity-80 shrink-0 ${
                              sec.is_active !== false
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}
                            title={
                              sec.is_active !== false
                                ? 'Active Section (Click to make inactive)'
                                : 'Inactive Section (Click to activate)'
                            }
                          >
                            {sec.is_active !== false ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => moveSection(idx, 'up', e)}
                            disabled={idx === 0}
                            className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground"
                            title="Move Up"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => moveSection(idx, 'down', e)}
                            disabled={idx === sections.length - 1}
                            className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground"
                            title="Move Down"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenSectionModal(sec);
                            }}
                            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground ml-1"
                            title="Edit Section"
                          >
                            <Edit2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Fields (w-2/3 on desktop) */}
            <div className="lg:col-span-8 bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                <div>
                  <h2 className="font-bold text-base text-foreground">Fields</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Drag to set priority.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleOpenFieldModal()}
                  className="bg-secondary/70 hover:bg-secondary text-secondary-foreground text-xs font-semibold tracking-wider uppercase"
                >
                  ADD FIELD
                </Button>
              </div>

              <div className="divide-y divide-border/60 max-h-[calc(100vh-250px)] overflow-y-auto">
                {currentSectionFields.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">
                    No fields in this section yet. Click{' '}
                    <span className="font-semibold text-foreground">&quot;ADD FIELD&quot;</span> to create one.
                  </div>
                ) : (
                  currentSectionFields.map((fld, idx) => {
                    const isActive = fld.is_active !== false;
                    const isChoiceType = ['dropdown', 'radio', 'multi-select'].includes(
                      fld.field_type
                    );
                    return (
                      <div
                        key={fld.id}
                        className={`flex items-center justify-between px-5 py-3.5 transition-colors border-b border-border/40 ${
                          isActive
                            ? 'hover:bg-muted/30'
                            : 'bg-amber-500/10 dark:bg-amber-500/15 border-l-4 border-l-amber-500 hover:bg-amber-500/20'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <GripVertical className="size-4 text-muted-foreground/50 shrink-0" />
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            [id:{fld.field_id_number || idx + 1}]
                          </span>
                          <span className="text-sm font-medium text-foreground truncate">
                            {fld.field_name}
                          </span>
                          {fld.system_key && (
                            <Badge className="bg-primary/15 text-primary border-0 text-[10px] px-1.5 py-0">
                              Predefined
                            </Badge>
                          )}
                          {fld.is_required && (
                            <Badge className="bg-destructive/15 text-destructive border-0 text-[10px] px-1.5 py-0">
                              Req
                            </Badge>
                          )}
                          {fld.show_in_table !== false && (
                            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-0 text-[10px] px-1.5 py-0">
                              Table
                            </Badge>
                          )}
                          {fld.is_sortable !== false && fld.show_in_table !== false && (
                            <Badge className="bg-purple-500/15 text-purple-600 dark:text-purple-400 border-0 text-[10px] px-1.5 py-0">
                              Sort
                            </Badge>
                          )}
                          {fld.is_searchable !== false && fld.show_in_table !== false && (
                            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0 text-[10px] px-1.5 py-0">
                              Search
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isChoiceType && (
                            <Button
                              size="sm"
                              onClick={() => handleOpenOptionsModal(fld)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1 h-7 rounded uppercase tracking-wide shadow-sm"
                            >
                              MANAGE OPTIONS
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={() => moveField(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground"
                            title="Move Up"
                          >
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveField(idx, 'down')}
                            disabled={idx === currentSectionFields.length - 1}
                            className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground"
                            title="Move Down"
                          >
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenFieldModal(fld)}
                            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground ml-1"
                            title="Edit Field"
                          >
                            <Edit2 className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleFieldStatus(fld)}
                            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                            title={isActive ? 'Deactivate Field (set inactive)' : 'Activate Field'}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                          <Badge
                            onClick={() => handleToggleFieldStatus(fld)}
                            className={`border-0 text-xs font-bold px-2.5 py-1 cursor-pointer select-none transition-all hover:opacity-85 shadow-sm ml-2 ${
                              isActive
                                ? 'bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700 font-bold tracking-wide'
                                : 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-800 font-extrabold tracking-wide ring-2 ring-amber-400'
                            }`}
                          >
                            {isActive ? 'Active' : 'Deactivated'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Section Modal ── */}
      <Dialog open={sectionModalOpen} onOpenChange={setSectionModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSection ? 'Edit Section' : 'Add Section'}
            </DialogTitle>
            <DialogDescription>
              Sections group related custom fields together (e.g. &quot;Address&quot;, &quot;Personal Details&quot;).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="secName">Section Name *</Label>
              <Input
                id="secName"
                placeholder="e.g. Address"
                value={sectionNameInput}
                onChange={(e) => setSectionNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSection();
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editingSection ? (
              <Button
                type="button"
                variant={editingSection.is_active !== false ? "outline" : "default"}
                onClick={() => {
                  handleToggleSectionStatus(editingSection);
                  setSectionModalOpen(false);
                }}
              >
                {editingSection.is_active !== false ? 'Deactivate Section' : 'Activate Section'}
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSectionModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveSection}>
                {editingSection ? 'Save Changes' : 'Create Section'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Field Modal ── */}
      <Dialog open={fieldModalOpen} onOpenChange={setFieldModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingField ? 'Edit Field' : 'Add Field'}
            </DialogTitle>
            <DialogDescription>
              Create or modify a custom field for {friendlyName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="fldName">Field Name *</Label>
              <Input
                id="fldName"
                placeholder="e.g. Date of birth, Blood Group"
                value={fieldNameInput}
                onChange={(e) => setFieldNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveField();
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fldType">Field Type</Label>
              <Select disabled={!!editingField?.system_key} value={fieldTypeInput} onValueChange={(val: any) => setFieldTypeInput(val || 'text')}>
                <SelectTrigger disabled={!!editingField?.system_key} id="fldType">
                  <SelectValue placeholder="Select type">
                    {FIELD_TYPES.find((t) => t.value === fieldTypeInput)?.label || 'Select type'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} label={t.label}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fldSec">Section</Label>
              <Select value={fieldSectionInput} onValueChange={(val: any) => setFieldSectionInput(val || '')}>
                <SelectTrigger id="fldSec">
                  <SelectValue placeholder="Select section">
                    {sections.find((s) => s.id === fieldSectionInput)?.name || 'Select section'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {['dropdown', 'radio', 'multi-select'].includes(fieldTypeInput) && (
              <div className="space-y-3 pt-3 border-t border-border">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Options Source</Label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={fieldSourceType === 'static'}
                      onChange={() => setFieldSourceType('static')}
                      className="accent-primary"
                    />
                    Static List
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={fieldSourceType === 'module'}
                      onChange={() => setFieldSourceType('module')}
                      className="accent-primary"
                    />
                    From Module
                  </label>
                </div>

                {fieldSourceType === 'static' ? (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Choices</p>
                    {fieldChoices.map((choice, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          value={choice}
                          onChange={(e) => {
                            const next = [...fieldChoices];
                            next[idx] = e.target.value;
                            setFieldChoices(next);
                          }}
                          placeholder={`Option ${idx + 1}`}
                          className="h-8 text-sm flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setFieldChoices(fieldChoices.filter((_, i) => i !== idx))}
                          disabled={fieldChoices.length === 1}
                          className="size-8 text-muted-foreground hover:text-red-500"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFieldChoices([...fieldChoices, ''])}
                      className="h-8 text-xs"
                    >
                      <Plus className="size-3.5 mr-1" /> Add Option
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="fldSourceMod">Source Module</Label>
                    <select
                      id="fldSourceMod"
                      value={fieldSourceModule}
                      onChange={(e) => setFieldSourceModule(e.target.value)}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none"
                    >
                      <option value="product">Products</option>
                      <option value="user">Users (Team)</option>
                      <option value="contact">Customers</option>
                      <option value="lead">Leads</option>
                      <option value="deal">Deals</option>
                      <option value="quotation">Quotations</option>
                      <option value="order">Orders</option>
                      <option value="dispatch">Dispatches</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      The dropdown options will automatically sync with all active records in this module.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Admin Validation & Table Settings */}
            <div className="space-y-3 pt-3 border-t border-border">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Validation & Data Table Settings
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 p-3 rounded-lg border border-border/50">
                <label className={`flex items-center gap-2 text-sm cursor-pointer select-none ${isProtectedRequired ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fieldIsRequired || !!isProtectedRequired}
                    disabled={!!isProtectedRequired}
                    onChange={(e) => {
                      if (!isProtectedRequired) {
                        setFieldIsRequired(e.target.checked);
                      }
                    }}
                    className={`size-4 accent-primary rounded ${isProtectedRequired ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  />
                  <span className="font-medium text-foreground">
                    Required Field {isProtectedRequired && '(Compulsory)'}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fieldShowInTable}
                    onChange={(e) => setFieldShowInTable(e.target.checked)}
                    className="size-4 accent-primary rounded cursor-pointer"
                  />
                  <span className="font-medium text-foreground">Show in Data Table</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer select-none ${!fieldShowInTable ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fieldIsSortable}
                    disabled={!fieldShowInTable}
                    onChange={(e) => setFieldIsSortable(e.target.checked)}
                    className="size-4 accent-primary rounded cursor-pointer"
                  />
                  <span className="text-foreground">Sortable in Table</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer select-none ${!fieldShowInTable ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fieldIsSearchable}
                    disabled={!fieldShowInTable}
                    onChange={(e) => setFieldIsSearchable(e.target.checked)}
                    className="size-4 accent-primary rounded cursor-pointer"
                  />
                  <span className="text-foreground">Searchable in Table</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer select-none sm:col-span-2 ${!fieldShowInTable ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fieldIsFilterable}
                    disabled={!fieldShowInTable}
                    onChange={(e) => setFieldIsFilterable(e.target.checked)}
                    className="size-4 accent-primary rounded cursor-pointer"
                  />
                  <span className="text-foreground">Filterable in Table</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editingField ? (
              <Button
                type="button"
                variant={editingField.is_active !== false ? "outline" : "default"}
                disabled={!!editingField.system_key}
                onClick={() => {
                  handleToggleFieldStatus(editingField);
                  setFieldModalOpen(false);
                }}
              >
                {editingField.is_active !== false ? 'Deactivate Field' : 'Activate Field'}
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFieldModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveField}>
                {editingField ? 'Save Changes' : 'Create Field'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manage Options Modal ── */}
      <Dialog open={optionsModalOpen} onOpenChange={setOptionsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Options</DialogTitle>
            <DialogDescription>
              Define selectable choices for &quot;{optionsField?.field_name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-4 border-b border-border pb-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={optionsSourceType === 'static'}
                  onChange={() => setOptionsSourceType('static')}
                  className="accent-primary"
                />
                Static List
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={optionsSourceType === 'module'}
                  onChange={() => setOptionsSourceType('module')}
                  className="accent-primary"
                />
                From Module
              </label>
            </div>

            {optionsSourceType === 'static' ? (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {optionsList.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      placeholder={`Option ${i + 1}`}
                      onChange={(e) => {
                        const next = [...optionsList];
                        next[i] = e.target.value;
                        setOptionsList(next);
                      }}
                    />
                    {optionsList.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setOptionsList(optionsList.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOptionsList([...optionsList, ''])}
                  className="w-full mt-2"
                >
                  <Plus className="size-4 mr-2" /> Add Option
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="optSourceMod">Source Module</Label>
                <select
                  id="optSourceMod"
                  value={optionsSourceModule}
                  onChange={(e) => setOptionsSourceModule(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none"
                >
                  <option value="product">Products</option>
                  <option value="user">Users (Team)</option>
                  <option value="contact">Customers</option>
                  <option value="lead">Leads</option>
                  <option value="deal">Deals</option>
                  <option value="quotation">Quotations</option>
                  <option value="order">Orders</option>
                  <option value="dispatch">Dispatches</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  The dropdown options will automatically sync with all active records in this module.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOptionsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveOptions}>
              Save Options
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

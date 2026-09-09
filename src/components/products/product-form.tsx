'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Product, CustomField, ProductCategory, ProductUnit } from '@/types';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
import { CustomFieldsSectionRenderer } from '@/components/custom-fields/custom-fields-section-renderer';
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from '@/lib/custom-fields';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Upload, X, Package, Plus } from 'lucide-react';
import { FormPageShell, FormActions, FormSection } from '@/components/shared';
import { logModuleActivity } from '@/lib/activities';

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
  product?: Product | null;
  onSaved: () => void;
}

export function ProductForm({
  open,
  onOpenChange,
  asPage = false,
  product,
  onSaved,
}: ProductFormProps) {
  const supabase = createClient();
  const { accountId, user, isModuleEnabled } = useAuth();
  const isEdit = !!product;
  const stockEnabled = isModuleEnabled('stock');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  // Multiple product images. `images` holds already-uploaded URLs; `newImageFiles`
  // are freshly picked files uploaded on save. products.image mirrors images[0].
  const [images, setImages] = useState<string[]>([]);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  // Stock Management: opening balance + per-product tracking flag (module-gated).
  const [trackStock, setTrackStock] = useState(true);
  const [openingStock, setOpeningStock] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // Hold the form body until custom-field defs load so sections paint in order.
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Tax slab + price floor. The slab supplies the rate an order line will
  // snapshot; min_price is the hard floor no stack of discounts may cross.
  const [taxSlabId, setTaxSlabId] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [taxSlabs, setTaxSlabs] = useState<{ id: string; name: string; rate: number }[]>([]);

  // Inline "create new" for the Unit and Tax dropdowns — add a master on the fly
  // without leaving the product form. The new record is selected immediately.
  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitShort, setNewUnitShort] = useState('');
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [newTaxOpen, setNewTaxOpen] = useState(false);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');
  const [creatingTax, setCreatingTax] = useState(false);
  const [newCatLevel, setNewCatLevel] = useState<1 | 2 | 3 | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  const [categoryId, setCategoryId] = useState('');
  const [l1Id, setL1Id] = useState('');
  const [l2Id, setL2Id] = useState('');
  const [l3Id, setL3Id] = useState('');
  const [unitId, setUnitId] = useState('');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  // Multi Unit: base unit = unitId (factor 1); these are the ALTERNATE units with
  // their decimal factor to the base. Base unit locks once the product is used.
  const [multiUnitEnabled, setMultiUnitEnabled] = useState(false);
  const [conversions, setConversions] = useState<{ unit_id: string; factor: string }[]>([]);
  const [baseUnitLocked, setBaseUnitLocked] = useState(false);
  const [levelsCount, setLevelsCount] = useState<1 | 2 | 3>(3);
  const [levelNames, setLevelNames] = useState({ l1: 'Category', l2: 'Sub-Category', l3: 'Brand' });

  useEffect(() => {
    if (open && accountId) {
      setConfirmDelete(false);
      setName(product?.name ?? '');
      setDescription(product?.description ?? '');
      setSku(product?.sku ?? '');
      setPrice(product?.price?.toString() ?? '');
      {
        const existing = (product as { images?: string[] | null })?.images;
        setImages(
          Array.isArray(existing) && existing.length > 0
            ? existing
            : product?.image
              ? [product.image]
              : [],
        );
      }
      setCategoryId(product?.category_id ?? '');
      setUnitId(product?.unit_id ?? '');
      // Fallback for legacy text values if needed
      setCategory(product?.category ?? '');
      setUnit(product?.unit ?? '');
      setTrackStock((product as { track_stock?: boolean })?.track_stock ?? true);
      setOpeningStock((product as { opening_stock?: number | null })?.opening_stock?.toString() ?? '');
      setTaxSlabId((product as { tax_slab_id?: string | null })?.tax_slab_id ?? '');
      setMinPrice((product as { min_price?: number | null })?.min_price?.toString() ?? '');
      setHsnCode((product as { hsn_code?: string | null })?.hsn_code ?? '');
      setNewImageFiles([]);
      setActive(product?.active ?? true);
      setFieldsLoaded(false);
      fetchCustomFields().finally(() => setFieldsLoaded(true));
      fetchTaxSlabs();
      fetchCategoriesAndUnits();
    }
  }, [open, product, accountId]);

  async function fetchCategoriesAndUnits() {
    if (!accountId) return;
    const [acctRes, catRes, unitRes] = await Promise.all([
      supabase.from('accounts').select('settings').eq('id', accountId).single(),
      supabase.from('product_categories').select('*').eq('account_id', accountId).order('level'),
      supabase.from('product_units').select('*').eq('account_id', accountId).order('name')
    ]);
    
    const ps = acctRes.data?.settings?.product_settings ?? {};
    setLevelsCount(ps.levels_count || 3);
    setLevelNames({
      l1: ps.level_1_name || 'Category',
      l2: ps.level_2_name || 'Sub-Category',
      l3: ps.level_3_name || 'Brand'
    });
    const muEnabled = !!acctRes.data?.settings?.extra_settings?.multi_unit_enabled;
    setMultiUnitEnabled(muEnabled);

    const cats = (catRes.data as ProductCategory[]) ?? [];
    setCategories(cats);
    setUnits((unitRes.data as ProductUnit[]) ?? []);

    // Multi Unit: load this product's conversion units, and lock the base unit
    // once the product has been used on an order or has a stock movement
    // (changing the base afterward would silently rewrite historical base qty).
    if (muEnabled && product?.id) {
      const [{ data: convRows }, { count: oiCount }, { count: slCount }] = await Promise.all([
        supabase.from('product_unit_conversions').select('unit_id, conversion_factor').eq('product_id', product.id),
        supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', product.id),
        supabase.from('stock_ledger').select('id', { count: 'exact', head: true }).eq('product_id', product.id),
      ]);
      setConversions(((convRows ?? []) as { unit_id: string; conversion_factor: number }[])
        .map((r) => ({ unit_id: r.unit_id, factor: String(r.conversion_factor) })));
      setBaseUnitLocked((oiCount ?? 0) > 0 || (slCount ?? 0) > 0);
    } else {
      setConversions([]);
      setBaseUnitLocked(false);
    }
    
    // Backtrack category hierarchy for existing product
    if (product?.category_id && cats.length > 0) {
      const targetCat = cats.find(c => c.id === product.category_id);
      if (targetCat) {
        if (targetCat.level === 3) {
          setL3Id(targetCat.id);
          setL2Id(targetCat.parent_id || '');
          const pCat = cats.find(c => c.id === targetCat.parent_id);
          setL1Id(pCat?.parent_id || '');
        } else if (targetCat.level === 2) {
          setL2Id(targetCat.id);
          setL1Id(targetCat.parent_id || '');
          setL3Id('');
        } else if (targetCat.level === 1) {
          setL1Id(targetCat.id);
          setL2Id('');
          setL3Id('');
        }
      }
    }
  }

  async function fetchTaxSlabs() {
    if (!accountId) return;
    const { data } = await supabase
      .from('tax_slabs')
      .select('id, name, rate')
      .eq('account_id', accountId)
      .order('position')
      .order('rate');
    setTaxSlabs(data ?? []);
  }

  async function createUnitInline() {
    if (!accountId || !newUnitName.trim()) return;
    setCreatingUnit(true);
    const { data, error } = await supabase
      .from('product_units')
      .insert({ account_id: accountId, name: newUnitName.trim(), short_name: newUnitShort.trim() || null })
      .select('*')
      .single();
    setCreatingUnit(false);
    if (error || !data) {
      toast.error(error?.message || 'Could not create unit');
      return;
    }
    setUnits((prev) => [...prev, data as ProductUnit].sort((a, b) => a.name.localeCompare(b.name)));
    setUnitId(data.id);
    setNewUnitName('');
    setNewUnitShort('');
    setNewUnitOpen(false);
    toast.success('Unit created');
  }

  async function createCategoryInline(level: 1 | 2 | 3) {
    if (!accountId || !newCatName.trim()) return;
    const parent_id = level === 1 ? null : level === 2 ? l1Id || null : l2Id || null;
    if (level > 1 && !parent_id) {
      toast.error(`Select a ${level === 2 ? levelNames.l1 : levelNames.l2} first`);
      return;
    }
    setCreatingCat(true);
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ account_id: accountId, name: newCatName.trim(), level, parent_id })
      .select('*')
      .single();
    setCreatingCat(false);
    if (error || !data) {
      toast.error(error?.message || 'Could not create');
      return;
    }
    setCategories((prev) => [...prev, data as ProductCategory]);
    if (level === 1) {
      setL1Id(data.id);
      setL2Id('');
      setL3Id('');
    } else if (level === 2) {
      setL2Id(data.id);
      setL3Id('');
    } else {
      setL3Id(data.id);
    }
    setNewCatName('');
    setNewCatLevel(null);
    toast.success('Created');
  }

  async function createTaxInline() {
    if (!accountId || !newTaxName.trim()) return;
    const rate = parseFloat(newTaxRate);
    if (Number.isNaN(rate)) {
      toast.error('Enter a valid tax rate');
      return;
    }
    setCreatingTax(true);
    const { data, error } = await supabase
      .from('tax_slabs')
      .insert({ account_id: accountId, name: newTaxName.trim(), rate })
      .select('id, name, rate')
      .single();
    setCreatingTax(false);
    if (error || !data) {
      toast.error(error?.message || 'Could not create tax slab');
      return;
    }
    setTaxSlabs((prev) => [...prev, data as { id: string; name: string; rate: number }]);
    setTaxSlabId(data.id);
    setNewTaxName('');
    setNewTaxRate('');
    setNewTaxOpen(false);
    toast.success('Tax slab created');
  }

  async function fetchCustomFields() {
    if (!accountId) return;
    if (user?.id) {
      await ensureDefaultSectionsAndFields(accountId, 'product', user.id, supabase);
    }
    const { data: fields } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('account_id', accountId)
      .eq('module_name', 'product')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    
    if (fields) {
      setCustomFields(fields as CustomField[]);
      
      if (isEdit && product?.id) {
        const { data: values } = await supabase
          .from('product_custom_values')
          .select('*')
          .eq('product_id', product.id);
          
        if (values) {
          const vals: Record<string, string> = {};
          values.forEach((v) => {
            if (v.value) vals[v.custom_field_id] = v.value;
          });
          setCustomValues(vals);
        }
      } else {
        setCustomValues({});
      }
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Product name is required');
      return;
    }
    if (!accountId || !user) return;

    // Predefined (system_key) fields keep their value in local state, not in
    // customValues — the validator must read them from formData or it will
    // reject a filled-in name. Mirror the real selection for each system key.
    const cfError = validateRequiredCustomFields(customFields, customValues, {
      name,
      sku,
      category: l3Id || l2Id || l1Id || category,
      unit: unitId || unit,
      price,
      min_price: minPrice,
    });
    if (cfError) {
      toast.error(cfError);
      return;
    }

    setSaving(true);

    try {
      // Upload any newly picked files, then combine with the already-uploaded
      // URLs (kept in order). image = images[0] keeps single-image readers working.
      const uploadedUrls: string[] = [];
      for (let i = 0; i < newImageFiles.length; i++) {
        const file = newImageFiles[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${accountId}-${Date.now()}-${i}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      const finalImages = [...images, ...uploadedUrls];
      const finalImageUrl = finalImages[0] ?? null;

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        sku: sku.trim() || null,
        price: price ? parseFloat(price) : null,
        image: finalImageUrl,
        images: finalImages.length > 0 ? finalImages : null,
        category: null,
        category_id: l3Id || l2Id || l1Id || null,
        unit: null,
        unit_id: unitId || null,
        // Stock fields written only when the module is on, so accounts without it
        // are never touched. Opening stock seeds the ledger via a DB trigger.
        ...(stockEnabled
          ? {
              track_stock: trackStock,
              opening_stock: openingStock !== '' && trackStock ? parseFloat(openingStock) : null,
            }
          : {}),
        // Empty string must become null, never '' — a uuid column rejects ''.
        tax_slab_id: taxSlabId || null,
        min_price: minPrice !== '' ? parseFloat(minPrice) : null,
        hsn_code: hsnCode.trim() || null,
        active,
      };

      let savedProductId = product?.id;

      if (isEdit && product) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', product.id);

        if (error) throw error;
        
        await logModuleActivity(supabase, {
          moduleName: 'product',
          recordId: product.id,
          action: 'Product Updated',
          message: `Product details for "${payload.name}" were updated.`,
          details: { updated_fields: Object.keys(payload) }
        });
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert({
            ...payload,
            account_id: accountId,
            user_id: user.id,
          })
          .select('id')
          .single();

        if (error) throw error;
        savedProductId = data.id;
        
        await logModuleActivity(supabase, {
          moduleName: 'product',
          recordId: data.id,
          action: 'Product Created',
          message: `Product "${payload.name}" was created.`,
        });
      }

      // Save Multi Unit conversion units (base unit = unit_id, factor 1, not stored
      // here). Replace-all: delete removed rows, upsert the current set. Only when
      // the feature is on; otherwise the product's existing conversions are left
      // untouched (turning the feature off never destroys data).
      if (multiUnitEnabled && savedProductId) {
        const clean = conversions
          .filter((c) => c.unit_id && c.unit_id !== unitId && Number(c.factor) > 0)
          .map((c) => ({
            account_id: accountId,
            product_id: savedProductId,
            unit_id: c.unit_id,
            conversion_factor: Number(c.factor),
            active: true,
          }));
        // Drop conversions the user removed, or that collide with the base unit.
        const keepUnitIds = clean.map((c) => c.unit_id);
        let del = supabase.from('product_unit_conversions').delete().eq('product_id', savedProductId);
        if (keepUnitIds.length > 0) del = del.not('unit_id', 'in', `(${keepUnitIds.join(',')})`);
        await del;
        if (clean.length > 0) {
          const { error: convErr } = await supabase
            .from('product_unit_conversions')
            .upsert(clean, { onConflict: 'product_id,unit_id' });
          if (convErr) throw convErr;
        }
      }

      // Save custom fields
      if (savedProductId) {
        const cfUpserts = customFields
          .filter((f) => customValues[f.id] !== undefined)
          .map((f) => ({
             product_id: savedProductId,
             custom_field_id: f.id,
             value: customValues[f.id]
          }));
        
        if (cfUpserts.length > 0) {
          await supabase.from('product_custom_values').delete().eq('product_id', savedProductId);
          await supabase.from('product_custom_values').insert(cfUpserts);
        }
      }

      toast.success(isEdit ? 'Product updated' : 'Product created');
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product) return;
    setDeleting(true);
    const { error } = await supabase.from('products').delete().eq('id', product.id);
    setDeleting(false);
    if (error) {
      toast.error('Failed to delete product');
      return;
    }
    toast.success('Product deleted');
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  // "+ Create new" affordance for a category level — a link that swaps to an
  // inline name input, inserts the category at that level, and selects it.
  const catCreateRow = (level: 1 | 2 | 3, label: string) =>
    newCatLevel === level ? (
      <div className="flex items-center gap-2">
        <Input
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          placeholder={`New ${label.toLowerCase()} name`}
          className="h-8 text-sm"
          autoFocus
        />
        <Button type="button" size="sm" className="h-8" disabled={creatingCat || !newCatName.trim()} onClick={() => createCategoryInline(level)}>
          {creatingCat ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setNewCatLevel(null)}>
          Cancel
        </Button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => { setNewCatLevel(level); setNewCatName(''); }}
        className="flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
      >
        <Plus className="h-3 w-3" /> Create new {label.toLowerCase()}
      </button>
    );

  const fieldGrid = asPage
    ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4"
    : undefined;

  const formContent = (
    <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {!fieldsLoaded ? (
              <div className="space-y-4" aria-hidden="true">
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                <div className={fieldGrid ?? "grid grid-cols-1 md:grid-cols-2 gap-4"}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                      <div className="h-9 w-full rounded bg-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
            <>
            {/* Image is always the FIRST field, matching every other module. */}
            <FormSection title="Product Image">
              <div className="flex flex-wrap items-center gap-3">
                {/* Already-uploaded images */}
                {images.map((url, idx) => (
                  <div key={`img-${idx}`} className="relative size-24 rounded-xl border border-border bg-muted overflow-hidden shrink-0 shadow-sm">
                    <img src={url} alt={`Product ${idx + 1}`} className="w-full h-full object-cover" />
                    {idx === 0 && (
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-0.5">Primary</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

                {/* Newly picked (not yet uploaded) files */}
                {newImageFiles.map((file, idx) => (
                  <div key={`new-${idx}`} className="relative size-24 rounded-xl border border-primary/40 bg-muted overflow-hidden shrink-0 shadow-sm">
                    <img src={URL.createObjectURL(file)} alt={`New ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setNewImageFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

                {/* Add tile — accepts multiple files at once */}
                <label className="size-24 rounded-xl border border-dashed border-border flex flex-col items-center justify-center gap-1 bg-muted shrink-0 cursor-pointer hover:bg-muted/80 hover:border-primary/50 transition-colors">
                  <Upload className="size-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Upload</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const picked = e.target.files ? Array.from(e.target.files) : [];
                      e.target.value = '';
                      if (picked.length > 0) {
                        setNewImageFiles((prev) => [...prev, ...picked]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Add one or more images. The first is the primary image shown in lists. Recommended 500×500px, max 10 MB.
              </p>
            </FormSection>

            <CustomFieldsSectionRenderer
              accountId={accountId}
              moduleName="product"
              fieldGridClassName={fieldGrid}
              customFields={customFields}
              customValues={customValues}
              onChange={(fieldId, val) =>
                setCustomValues((prev) => ({ ...prev, [fieldId]: val }))
              }
              formData={{
                name,
                sku,
                category,
                unit,
                price,
                min_price: minPrice,
              }}
              onFormDataChange={(key, val) => {
                if (key === 'name') setName(val);
                if (key === 'sku') setSku(val);
                if (key === 'category') setCategory(val);
                if (key === 'unit') setUnit(val);
                if (key === 'price') setPrice(val);
                if (key === 'min_price') setMinPrice(val);
              }}
              renderCustomSystemField={(fld) => {
                if (fld.system_key === 'category') {
                  const level1 = categories.filter(c => c.level === 1);
                  const level2 = categories.filter(c => c.level === 2 && c.parent_id === l1Id);
                  const level3 = categories.filter(c => c.level === 3 && c.parent_id === l2Id);

                  return (
                    <div className="grid gap-2">
                      <select
                        value={l1Id}
                        onChange={(e) => {
                          setL1Id(e.target.value);
                          setL2Id('');
                          setL3Id('');
                        }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select {levelNames.l1}</option>
                        {level1.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      {catCreateRow(1, levelNames.l1)}

                      {levelsCount >= 2 && (
                        <select
                          value={l2Id}
                          onChange={(e) => {
                            setL2Id(e.target.value);
                            setL3Id('');
                          }}
                          disabled={!l1Id}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                        >
                          <option value="">Select {levelNames.l2}</option>
                          {level2.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                      {levelsCount >= 2 && l1Id && catCreateRow(2, levelNames.l2)}

                      {levelsCount >= 3 && (
                        <select
                          value={l3Id}
                          onChange={(e) => setL3Id(e.target.value)}
                          disabled={!l2Id}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                        >
                          <option value="">Select {levelNames.l3}</option>
                          {level3.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                      {levelsCount >= 3 && l2Id && catCreateRow(3, levelNames.l3)}
                    </div>
                  );
                }
                if (fld.system_key === 'unit') {
                  const usedUnitIds = new Set([unitId, ...conversions.map((c) => c.unit_id)].filter(Boolean));
                  return (
                    <div className="grid gap-1">
                      {multiUnitEnabled && <span className="text-[11px] font-medium text-muted-foreground">Base unit</span>}
                      <select
                        value={unitId}
                        onChange={(e) => setUnitId(e.target.value)}
                        disabled={baseUnitLocked}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Unit</option>
                        {units.map(u => (
                          <option key={u.id} value={u.id}>{u.name} {u.short_name ? `(${u.short_name})` : ''}</option>
                        ))}
                      </select>
                      {baseUnitLocked && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Base unit is locked because this product already has orders or stock. You can still add or remove conversion units below.
                        </p>
                      )}
                      {multiUnitEnabled && unitId && (
                        <div className="mt-2 rounded-md border border-border bg-muted/20 p-2 space-y-2">
                          <p className="text-[11px] font-medium text-foreground">Conversion units (1 of this = N base units)</p>
                          {conversions.map((c, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <select
                                value={c.unit_id}
                                onChange={(e) => setConversions((prev) => prev.map((x, ix) => ix === i ? { ...x, unit_id: e.target.value } : x))}
                                className="h-8 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                              >
                                <option value="">Select unit</option>
                                {units.filter((u) => u.id === c.unit_id || !usedUnitIds.has(u.id)).map((u) => (
                                  <option key={u.id} value={u.id}>{u.name}{u.short_name ? ` (${u.short_name})` : ''}</option>
                                ))}
                              </select>
                              <span className="text-xs text-muted-foreground">=</span>
                              <Input
                                type="number" min="0" step="0.000001" value={c.factor}
                                onChange={(e) => setConversions((prev) => prev.map((x, ix) => ix === i ? { ...x, factor: e.target.value } : x))}
                                placeholder="e.g. 12"
                                className="h-8 w-24 text-sm"
                              />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {units.find((u) => u.id === unitId)?.short_name || units.find((u) => u.id === unitId)?.name || 'base'}
                              </span>
                              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                                onClick={() => setConversions((prev) => prev.filter((_, ix) => ix !== i))}>
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </div>
                          ))}
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => setConversions((prev) => [...prev, { unit_id: '', factor: '' }])}>
                            <Plus className="h-3 w-3 mr-1" /> Add conversion unit
                          </Button>
                        </div>
                      )}
                      {!newUnitOpen ? (
                        <button
                          type="button"
                          onClick={() => setNewUnitOpen(true)}
                          className="mt-1 flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
                        >
                          <Plus className="h-3 w-3" /> Create new unit
                        </button>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                          <Input
                            value={newUnitName}
                            onChange={(e) => setNewUnitName(e.target.value)}
                            placeholder="Unit name (e.g. Box)"
                            className="h-8 flex-1 min-w-[120px] text-sm"
                          />
                          <Input
                            value={newUnitShort}
                            onChange={(e) => setNewUnitShort(e.target.value)}
                            placeholder="Short (e.g. BX)"
                            className="h-8 w-24 text-sm"
                          />
                          <Button type="button" size="sm" className="h-8" disabled={creatingUnit || !newUnitName.trim()} onClick={createUnitInline}>
                            {creatingUnit ? 'Adding…' : 'Add'}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setNewUnitOpen(false)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                }
                if (fld.system_key === 'min_price') {
                  return (
                    <div className="grid gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        placeholder="No floor"
                        className="border-border bg-muted text-foreground"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Discounts can never take this product below this price.
                      </p>
                    </div>
                  );
                }
                // Every other predefined field (name, sku, price, …) falls
                // through to the default input. Returning null here would HIDE
                // the field — that is what made core fields disappear.
                return undefined;
              }}
            />

            <div className="space-y-4 pt-4 border-t border-border/50">
              <h4 className="text-sm font-medium text-foreground">Additional Details</h4>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description..."
                  className="min-h-[80px] border-border bg-muted text-foreground"
                />
              </div>

              {stockEnabled && (
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="track_stock"
                      checked={trackStock}
                      onChange={(e) => setTrackStock(e.target.checked)}
                      className="rounded border-border bg-muted accent-primary"
                    />
                    <Label htmlFor="track_stock" className="text-foreground font-normal">
                      Maintain stock for this product
                    </Label>
                  </div>
                  {trackStock ? (
                    <div className="grid gap-2">
                      <Label className="text-muted-foreground">Opening stock</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={openingStock}
                        onChange={(e) => setOpeningStock(e.target.value)}
                        placeholder="0"
                        className="border-border bg-muted text-foreground max-w-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        The starting balance. Closing stock is then calculated automatically from
                        orders, dispatches and manual adjustments — set it once here.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Stock is not tracked for this product (e.g. a service). It will never show a
                      stock figure or block an order.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Tax slab</Label>
                  <select
                    value={taxSlabId}
                    onChange={(e) => setTaxSlabId(e.target.value)}
                    className="h-9 rounded-md border border-border bg-muted px-3 text-sm text-foreground"
                  >
                    <option value="">No tax (0%)</option>
                    {taxSlabs.map((slab) => (
                      <option key={slab.id} value={slab.id}>
                        {slab.name} — {Number(slab.rate)}%
                      </option>
                    ))}
                  </select>
                  {!newTaxOpen ? (
                    <button
                      type="button"
                      onClick={() => setNewTaxOpen(true)}
                      className="flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" /> Create new tax slab
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                      <Input
                        value={newTaxName}
                        onChange={(e) => setNewTaxName(e.target.value)}
                        placeholder="Name (e.g. GST 18%)"
                        className="h-8 flex-1 min-w-[120px] text-sm"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newTaxRate}
                        onChange={(e) => setNewTaxRate(e.target.value)}
                        placeholder="Rate %"
                        className="h-8 w-20 text-sm"
                      />
                      <Button type="button" size="sm" className="h-8" disabled={creatingTax || !newTaxName.trim()} onClick={createTaxInline}>
                        {creatingTax ? 'Adding…' : 'Add'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setNewTaxOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                {/* HSN Code */}
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">HSN / SAC Code</Label>
                  <Input
                    type="text"
                    value={hsnCode}
                    onChange={(e) => setHsnCode(e.target.value)}
                    placeholder="e.g. 3304, 6109"
                    className="border-border bg-muted text-foreground"
                    maxLength={8}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Harmonised System of Nomenclature code for GST invoicing.
                  </p>
                </div>
              </div>


              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox"
                  id="active"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-border bg-muted accent-primary"
                />
                <Label htmlFor="active" className="text-muted-foreground font-normal">Active Product</Label>
              </div>
            </div>
          </>
          )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4 shrink-0 mt-auto">
            <FormActions
              bare
              submit
              onCancel={() => onOpenChange(false)}
              saving={saving}
              saveDisabled={!name.trim()}
              saveLabel={isEdit ? 'Save Changes' : 'Create Product'}
            />

            {isEdit &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Delete this product?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? 'Deleting...' : 'Confirm'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Product
                </button>
              ))}
          </div>
        </form>
  );

  if (asPage) {
    return (
      <FormPageShell
        icon={Package}
        title={isEdit ? 'Edit Product' : 'Add New Product'}
        subtitle={isEdit ? 'Update the product details below.' : 'Create a new product in your catalog.'}
        onBack={() => onOpenChange(false)}
        width="none"
      >
        {formContent}
      </FormPageShell>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-4xl w-full p-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="border-b border-border/50 p-4 shrink-0">
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Edit Product' : 'New Product'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground hidden">
            Create or edit a product.
          </DialogDescription>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
}

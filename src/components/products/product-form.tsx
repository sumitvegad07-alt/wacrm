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
import { Trash2, Upload, X, ArrowLeft, Package } from 'lucide-react';
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
  const { accountId, user } = useAuth();
  const isEdit = !!product;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [stock, setStock] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Tax slab + price floor. The slab supplies the rate an order line will
  // snapshot; min_price is the hard floor no stack of discounts may cross.
  const [taxSlabId, setTaxSlabId] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [taxSlabs, setTaxSlabs] = useState<{ id: string; name: string; rate: number }[]>([]);

  // Category and Unit
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [levelNames, setLevelNames] = useState({ l1: 'Category', l2: 'Sub-Category', l3: 'Brand' });

  useEffect(() => {
    if (open && accountId) {
      setConfirmDelete(false);
      setName(product?.name ?? '');
      setDescription(product?.description ?? '');
      setSku(product?.sku ?? '');
      setPrice(product?.price?.toString() ?? '');
      setImage(product?.image ?? '');
      setCategoryId(product?.category_id ?? '');
      setUnitId(product?.unit_id ?? '');
      // Fallback for legacy text values if needed
      setCategory(product?.category ?? '');
      setUnit(product?.unit ?? '');
      setStock(product?.stock?.toString() ?? '');
      setTaxSlabId((product as { tax_slab_id?: string | null })?.tax_slab_id ?? '');
      setMinPrice((product as { min_price?: number | null })?.min_price?.toString() ?? '');
      setImageFile(null);
      setActive(product?.active ?? true);
      fetchCustomFields();
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
    setLevelNames({
      l1: ps.level_1_name || 'Category',
      l2: ps.level_2_name || 'Sub-Category',
      l3: ps.level_3_name || 'Brand'
    });
    setCategories((catRes.data as ProductCategory[]) ?? []);
    setUnits((unitRes.data as ProductUnit[]) ?? []);
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

    const cfError = validateRequiredCustomFields(customFields, customValues);
    if (cfError) {
      toast.error(cfError);
      return;
    }

    setSaving(true);

    try {
      let finalImageUrl = image.trim() || null;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${accountId}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, imageFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(fileName);
          
        finalImageUrl = publicUrl;
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        sku: sku.trim() || null,
        price: price ? parseFloat(price) : null,
        image: finalImageUrl,
        category: null,
        category_id: categoryId || null,
        unit: null,
        unit_id: unitId || null,
        stock: stock !== '' ? parseFloat(stock) : null,
        // Empty string must become null, never '' — a uuid column rejects ''.
        tax_slab_id: taxSlabId || null,
        min_price: minPrice !== '' ? parseFloat(minPrice) : null,
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

  const formContent = (
    <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <CustomFieldsSectionRenderer
              accountId={accountId}
              moduleName="product"
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
                  const level2 = categories.filter(c => c.level === 2);
                  const level3 = categories.filter(c => c.level === 3);

                  return (
                    <div className="grid gap-1">
                      <select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select {levelNames.l1}</option>
                        {level1.map(l1 => (
                          <optgroup key={l1.id} label={l1.name}>
                            <option value={l1.id}>{l1.name} ({levelNames.l1})</option>
                            {level2.filter(c => c.parent_id === l1.id).map(l2 => (
                              <optgroup key={l2.id} label={`-- ${l2.name}`}>
                                <option value={l2.id}>{l2.name} ({levelNames.l2})</option>
                                {level3.filter(c => c.parent_id === l2.id).map(l3 => (
                                  <option key={l3.id} value={l3.id}>---- {l3.name} ({levelNames.l3})</option>
                                ))}
                              </optgroup>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  );
                }
                if (fld.system_key === 'unit') {
                  return (
                    <div className="grid gap-1">
                      <select
                        value={unitId}
                        onChange={(e) => setUnitId(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select Unit</option>
                        {units.map(u => (
                          <option key={u.id} value={u.id}>{u.name} {u.short_name ? `(${u.short_name})` : ''}</option>
                        ))}
                      </select>
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
                return null;
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Stock</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="Leave blank if not tracked"
                    className="border-border bg-muted text-foreground"
                  />
                </div>
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
                  {taxSlabs.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      No slabs defined yet. Add them in Settings → Pricing &amp; Schemes.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">Product Image</Label>
                <div className="flex items-center gap-4">
                  {(image || imageFile) ? (
                    <div className="relative size-16 rounded-md border border-border bg-muted overflow-hidden shrink-0">
                      <img 
                        src={imageFile ? URL.createObjectURL(imageFile) : image} 
                        alt="Preview" 
                        className="w-full h-full object-cover" 
                      />
                      <button
                        type="button"
                        onClick={() => { setImage(''); setImageFile(null); }}
                        className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="size-16 rounded-md border border-dashed border-border flex items-center justify-center bg-muted shrink-0 cursor-pointer hover:bg-muted/80 hover:border-primary/50 transition-colors">
                      <Upload className="size-5 text-muted-foreground" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setImageFile(e.target.files[0]);
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  )}
                  <div className="text-sm text-muted-foreground">
                    Upload a product image. <br/>Recommended size: 500x500px.
                  </div>
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
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4 shrink-0 mt-auto">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim()}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>

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
      <div className="p-8 w-full max-w-none space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 w-9 border border-border hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4 text-foreground" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Package className="w-6 h-6 text-primary" />
                {isEdit ? 'Edit Product' : 'Add New Product'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isEdit ? 'Update the product details below.' : 'Create a new product in your catalog.'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {formContent}
        </div>
      </div>
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

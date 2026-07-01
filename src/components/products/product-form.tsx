'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Product, CustomField } from '@/types';
import { CustomFieldInput } from '@/components/ui/custom-field-input';
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
import { Trash2, Upload, X } from 'lucide-react';
import { logModuleActivity } from '@/lib/activities';

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSaved: () => void;
}

export function ProductForm({
  open,
  onOpenChange,
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && accountId) {
      setConfirmDelete(false);
      setName(product?.name ?? '');
      setDescription(product?.description ?? '');
      setSku(product?.sku ?? '');
      setPrice(product?.price?.toString() ?? '');
      setImage(product?.image ?? '');
      setCategory(product?.category ?? '');
      setUnit(product?.unit ?? '');
      setImageFile(null);
      setActive(product?.active ?? true);
      fetchCustomFields();
    }
  }, [open, product, accountId]);

  async function fetchCustomFields() {
    if (!accountId) return;
    const { data: fields } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('module_name', 'product')
      .order('field_name');
    
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
        category: category.trim() || null,
        unit: unit.trim() || null,
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

        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Product Name <span className="text-red-400">*</span></Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Product Name"
                  className="border-border bg-muted text-foreground"
                  autoFocus
                />
              </div>

              <div className="grid gap-2 md:col-span-2">
                <Label className="text-muted-foreground">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description..."
                  className="min-h-[80px] border-border bg-muted text-foreground"
                />
              </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">SKU</Label>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g. ITEM-001"
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>

            <div className="grid gap-2 md:col-span-2">
              <Label className="text-muted-foreground">Category</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electronics"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 md:col-span-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Unit</Label>
                <Input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. pcs, kg, hr"
                  className="border-border bg-muted text-foreground"
                />
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

            {customFields.length > 0 && (
              <div className="space-y-4 pt-4 mt-4 border-t border-border/50 md:col-span-2">
                <h4 className="text-sm font-medium text-foreground">Custom Fields</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {customFields.map((field) => (
                    <div key={field.id} className="grid gap-2">
                      <Label className="text-muted-foreground capitalize">
                        {field.field_name}
                      </Label>
                      <CustomFieldInput 
                        field={field} 
                        value={customValues[field.id] ?? ''} 
                        onChange={(val) => setCustomValues((prev) => ({ ...prev, [field.id]: val }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
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
      </DialogContent>
    </Dialog>
  );
}

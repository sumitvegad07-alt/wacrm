'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMarkRecordSeen } from "@/hooks/use-record-views";
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Product, CustomField, Task } from '@/types';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Loader2, FileText, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { ProductForm } from '@/components/products/product-form';
import { TaskForm } from '@/components/tasks/task-form';
import { Timeline } from '@/components/shared/timeline';
import {
  DetailPageLayout,
  DetailSection,
  DetailGrid,
  DetailItem,
  StatusBadge,
} from '@/components/shared';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

export default function ProductDetailsPage() {
  const { id } = useParams() as { id: string };

  // Opening the record is what clears its highlight on the list.
  useMarkRecordSeen("product", id);
  const router = useRouter();
  const supabase = createClient();
  const { account } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    
    // 1. Fetch Product
    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('*, category_rel:product_categories(name), unit_rel:product_units(name, short_name)')
      .eq('id', id)
      .maybeSingle();

    if (productError || !productData) {
      toast.error('Product not found');
      router.push('/products');
      return;
    }
    setProduct(productData);

    // 2. Fetch everything else in parallel
    const [
      fieldsRes,
      valuesRes,
      tasksRes,
      actRes
    ] = await Promise.all([
      supabase
        .from('custom_fields')
        .select('*')
        .eq('account_id', productData.account_id)
        .eq('module_name', 'product')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase.from('product_custom_values').select('*').eq('product_id', id),
      supabase.from('tasks').select('*').eq('product_id', id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'product').eq('record_id', id).order('created_at', { ascending: false })
    ]);

    // Custom Fields
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v: any) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    
    // Tasks
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);

    if (actRes.data && actRes.data.length > 0) {
      const userIds = Array.from(new Set(actRes.data.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        
        const enrichedActivities = actRes.data.map((a: any) => ({
          ...a,
          user: profileMap[a.user_id] || null
        }));
        setActivities(enrichedActivities);
      } else {
        setActivities(actRes.data);
      }
    } else {
      setActivities([]);
    }

    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) return null;

  // The product's field setup drives this page the same way it drives the form: a
  // deactivated field disappears (the seeded "Unit Price" is deactivated on every
  // account and has no products column at all), a renamed field re-labels, and a
  // predefined (system_key) field reads its value from the product row — never
  // from product_custom_values, which only ever holds true custom fields.
  const activeFields = customFields.filter((f) => f.is_active !== false);
  // Predefined keys already drawn in "Product Details" above, so "Other Details"
  // must not repeat them. Category and Unit are deliberately NOT here: nothing
  // else on this page shows them, so they stay in the block below and now render
  // their real value instead of a permanent "-".
  const NATIVE_SYSTEM_KEYS = new Set([
    'name',
    'sku',
    'price',
    'description',
    'active',
    'image',
    'images',
    'category_id',
    'unit_id',
    'tax_slab_id',
  ]);
  const productRowValue = (key: string): string => {
    const row = product as any;
    // category / unit moved to the masters (category_id / unit_id) and new writes
    // null the legacy text column, so read the joined name first — same order the
    // products list uses.
    if (key === 'category') return row.category_rel?.name || row.category || '';
    if (key === 'unit') return row.unit_rel?.short_name || row.unit_rel?.name || row.unit || '';
    const raw = row[key];
    if (raw == null || raw === '') return '';
    return String(raw);
  };
  const systemRows = activeFields
    .filter((f) => f.system_key && !NATIVE_SYSTEM_KEYS.has(f.system_key))
    .map((f) => ({ field: f, value: productRowValue(f.system_key as string) }))
    .filter((r) => r.value !== '');
  const extraFields = activeFields.filter((f) => !f.system_key);

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

  return (
    <DetailPageLayout
      title={product.name}
      onBack={() => router.back()}
      // The status was a hand-rolled emerald/slate Badge at 10px. StatusBadge
      // maps the value through the shared status vocabulary, so Active here
      // looks like Active everywhere else in the app.
      badges={<StatusBadge status={product.active ? "active" : "inactive"} />}
      meta={
        product.sku ? (
          <span className="flex items-center gap-1 font-mono">
            <Link2 className="size-3" /> SKU: {product.sku}
          </span>
        ) : undefined
      }
      actions={
        <>
          <Button variant="outline" onClick={() => setTaskFormOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Add Task
          </Button>
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit
          </Button>
        </>
      }
    >

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          
          {product.image && (
            <DetailSection title="Product Image" className="flex flex-col gap-3">
              <div className="relative w-full max-w-sm rounded-lg overflow-hidden border border-border">
                <img src={product.image} alt={product.name} className="w-full h-auto object-cover" />
              </div>
              <a 
                href={product.image} 
                download={`${product.name}-image.jpg`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body font-medium text-primary hover:underline w-fit"
              >
                Download Image
              </a>
            </DetailSection>
          )}

          <DetailSection title="Product Details">
            
            <DetailGrid>
              <DetailItem label="Name" value={product.name} />
              <DetailItem label="Product Code" value={product.sku} />
              <DetailItem
                label="Price"
                value={product.price != null ? formatCurrency(product.price, account?.default_currency) : undefined}
              />
              <DetailItem label="Status" value={product.active ? 'Active' : 'Inactive'} />
              <DetailItem span="full" label="Description">
                {product.description ? (
                  <span className="whitespace-pre-wrap">{product.description}</span>
                ) : undefined}
              </DetailItem>
            </DetailGrid>

            {(systemRows.length > 0 || extraFields.length > 0) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="mb-4 text-section font-semibold text-foreground">Other Details</h3>
                <DetailGrid>
                  {systemRows.map(({ field, value }) => (
                    <DetailItem
                      key={field.id}
                      label={field.field_name}
                      className="[&>p:first-child]:capitalize"
                      value={value}
                    />
                  ))}
                  {extraFields.map((field) => {
                    const val = customValues[field.id];
                    return (
                      <DetailItem
                        key={field.id}
                        label={field.field_name}
                        className="[&>p:first-child]:capitalize"
                        value={field.field_type === 'attachment' ? undefined : val}
                      >
                        {field.field_type === 'attachment' && val ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-primary hover:underline">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : undefined}
                      </DetailItem>
                    );
                  })}
                </DetailGrid>
              </>
            )}
          </DetailSection>
        </div>

        {/* Right Column: Timeline */}
        <div className="w-full">
          <Timeline 
            moduleName="product" 
            recordId={product.id} 
            tasks={tasks} 
            activities={activities} 
            onRefresh={fetchAllData} 
          />
        </div>
      </div>

      <ProductForm
        open={editOpen}
        onOpenChange={setEditOpen}
        product={product}
        onSaved={fetchAllData}
      />
      
      <TaskForm
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        defaultProductId={product.id}
        onSaved={fetchAllData}
      />
    </DetailPageLayout>
  );
}

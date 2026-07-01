'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Product, CustomField, Task } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Package, Calendar, CheckSquare, Plus, Pencil, Loader2, FileText, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { ProductForm } from '@/components/products/product-form';
import { TaskForm } from '@/components/tasks/task-form';
import { Timeline } from '@/components/shared/timeline';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

export default function ProductDetailsPage() {
  const { id } = useParams() as { id: string };
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
      .select('*')
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
      supabase.from('custom_fields').select('*').eq('module_name', 'product').order('field_name'),
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

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

  return (
    <div className="space-y-6 max-w-7xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
              <Package className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
                {product.name}
              </h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
                {product.sku && <span className="flex items-center gap-1 font-mono text-xs"><Link2 className="size-3" /> SKU: {product.sku}</span>}
                {product.active ? (
                  <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 py-0 text-[10px]">Active</Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200 py-0 text-[10px]">Inactive</Badge>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTaskFormOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Add Task
          </Button>
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          
          {product.image && (
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
              <h3 className="text-lg font-semibold">Product Image</h3>
              <div className="relative w-full max-w-sm rounded-lg overflow-hidden border border-border">
                <img src={product.image} alt={product.name} className="w-full h-auto object-cover" />
              </div>
              <a 
                href={product.image} 
                download={`${product.name}-image.jpg`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm font-medium w-fit"
              >
                Download Image
              </a>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Product Details</h3>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Name</p>
                <p className="font-medium">{product.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">SKU</p>
                <p className="font-medium">{product.sku || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Price</p>
                <p className="font-medium">{product.price != null ? formatCurrency(product.price, account?.default_currency) : '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <p className="font-medium">{product.active ? 'Active' : 'Inactive'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground mb-1">Description</p>
                <p className="font-medium whitespace-pre-wrap">{product.description || '-'}</p>
              </div>
            </div>

            {customFields.length > 0 && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-4">Other Details</h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {customFields.map((field) => {
                    const val = customValues[field.id];
                    return (
                      <div key={field.id}>
                        <p className="text-sm text-muted-foreground mb-1 capitalize">{field.field_name}</p>
                        {field.field_type === 'attachment' && val ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium flex items-center gap-1">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : (
                          <p className="font-medium break-words">{val || '-'}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
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
    </div>
  );
}

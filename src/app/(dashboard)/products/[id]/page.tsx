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

export default function ProductDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();

  const [product, setProduct] = useState<Product | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  
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
      tasksRes
    ] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('module_name', 'product').order('field_name'),
      supabase.from('product_custom_values').select('*').eq('product_id', id),
      supabase.from('tasks').select('*').eq('product_id', id).order('created_at', { ascending: false })
    ]);

    // Custom Fields
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    
    // Tasks
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);

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
                <p className="font-medium">{product.price != null ? `$${product.price.toFixed(2)}` : '-'}</p>
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
        <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden h-[calc(100vh-140px)] sticky top-6">
          <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="size-4" />
              Timeline
            </h3>
            <Button variant="ghost" size="icon-sm" onClick={() => setTaskFormOpen(true)} className="h-7 w-7">
              <Plus className="size-4" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-8">
            {/* Planned Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Planned</h4>
              {plannedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No upcoming activities.</p>
              ) : (
                <div className="space-y-4">
                  {plannedTasks.map(task => (
                    <div key={task.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-primary before:ring-4 before:ring-card">
                      <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border last:hidden" />
                      <p className="text-sm font-medium">
                        <Link href={`/tasks/${task.id}`} className="hover:underline text-primary">{task.title}</Link>
                      </p>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{task.priority}</Badge>
                        {task.due_date && <span>Scheduled: {new Date(task.due_date).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Past</h4>
              {pastTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No past activities.</p>
              ) : (
                <div className="space-y-4 pb-4">
                  {pastTasks.map((t, i, arr) => (
                    <div key={`task-${t.id}`} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                      {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
                      
                      <div className="text-sm">
                        <p className="font-medium flex items-center gap-2">
                          <CheckSquare className="size-3 text-green-500" />
                          <Link href={`/tasks/${t.id}`} className="hover:underline line-through text-muted-foreground">
                            {t.title}
                          </Link>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">Completed task • {new Date(t.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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

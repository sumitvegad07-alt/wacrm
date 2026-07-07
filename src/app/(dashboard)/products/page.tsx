'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Product, CustomField } from '@/types';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Upload,
  CheckCircle,
  Ban,
  SlidersHorizontal,
} from 'lucide-react';
import { ProductForm } from '@/components/products/product-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ImportProductsModal } from '@/components/products/import-products-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { CustomFieldsDialog } from "@/components/custom-fields/custom-fields-dialog";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export default function ProductsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account } = useAuth();
  const canEditSettings = useCan('edit-settings');

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // DataTable state
  const [globalSearch, setGlobalSearch] = useState('');
  const [hideInactive, setHideInactive] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  
  // Lookups
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    
    const [{ data: productsData }, { data: fieldsData }] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('module_name', 'product')
    ]);

    setCustomFields(fieldsData || []);

    let enhancedProducts = productsData || [];
    if (productsData && productsData.length > 0) {
      const productIds = productsData.map(p => p.id);
      const { data: valuesData } = await supabase
        .from('product_custom_values')
        .select('*')
        .in('product_id', productIds);

      if (valuesData && valuesData.length > 0) {
        enhancedProducts = productsData.map(product => {
          const productValues = valuesData.filter((v: any) => v.product_id === product.id);
          const customData: any = {};
          productValues.forEach((v: any) => {
            customData[`cf_${v.custom_field_id}`] = v.value;
          });
          return { ...product, ...customData };
        });
      }
    }

    setProducts(enhancedProducts);
    setLoading(false);
    setSelectedProductIds(new Set());
  }, [supabase]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setFormOpen(true);
      router.replace('/products');
    }
  }, [searchParams, router]);

  async function handleBulkDelete() {
    if (selectedProductIds.size === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${selectedProductIds.size} products? This cannot be undone.`)) {
      return;
    }

    setBulkActionLoading(true);
    const { error } = await supabase
      .from('products')
      .delete()
      .in('id', Array.from(selectedProductIds));

    setBulkActionLoading(false);
    if (error) {
      toast.error('Failed to delete products');
    } else {
      toast.success(`${selectedProductIds.size} products deleted`);
      fetchProducts();
    }
  }

  async function handleBulkToggleActive(active: boolean) {
    if (selectedProductIds.size === 0) return;
    
    setBulkActionLoading(true);
    const { error } = await supabase
      .from('products')
      .update({ active })
      .in('id', Array.from(selectedProductIds));

    setBulkActionLoading(false);
    if (error) {
      toast.error(`Failed to mark products as ${active ? 'active' : 'inactive'}`);
    } else {
      toast.success(`${selectedProductIds.size} products marked as ${active ? 'active' : 'inactive'}`);
      fetchProducts();
    }
  }

  const columns: ColumnDef<any>[] = [
    {
      id: "name",
      label: "Product",
      type: "text",
      render: (product) => (
        <div className="flex items-center gap-3">
          {product.image ? (
            <img src={product.image} alt={product.name} className="w-10 h-10 rounded-md object-cover border border-border" />
          ) : (
            <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No img</span>
            </div>
          )}
          <div>
            <div className="font-medium text-foreground">{product.name}</div>
            {product.description && (
              <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                {product.description}
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: "category",
      label: "Category",
      type: "text",
      render: (product) => <span className="text-muted-foreground">{product.category || '—'}</span>
    },
    {
      id: "sku",
      label: "SKU",
      type: "text",
      render: (product) => <span className="text-muted-foreground">{product.sku || '—'}</span>
    },
    {
      id: "price",
      label: "Price",
      type: "text",
      render: (product) => (
        <span>
          {product.price != null ? formatCurrency(product.price, account?.default_currency) : '—'}
          {product.unit && <span className="text-muted-foreground text-xs ml-1">/ {product.unit}</span>}
        </span>
      )
    },
    {
      id: "active",
      label: "Status",
      type: "select",
      options: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      render: (product) => (
        product.active ? (
          <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>
        ) : (
          <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">Inactive</Badge>
        )
      )
    },
    {
      id: "created_at",
      label: "Created at",
      type: "date",
      visibleByDefault: false,
      render: (product) => (
        <span className="text-muted-foreground text-sm">
          {new Date(product.created_at).toLocaleDateString()}
        </span>
      )
    },
    {
      id: "actions",
      label: "",
      visibleByDefault: true,
      render: (product) => (
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" />}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 border-border bg-popover">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditProduct(product); setFormOpen(true); }}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem className="text-red-500 focus:text-red-600 focus:bg-red-500/10" onClick={(e) => { e.stopPropagation(); setDeleteTarget(product); setDeleteConfirmOpen(true); }}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  // Append custom fields
  customFields.forEach(cf => {
    let type: any = "text";
    let options: any[] = [];
    if (cf.field_type === 'dropdown' || cf.field_type === 'radio' || cf.field_type === 'multi-select') {
      type = "select";
      const uniqueVals = Array.from(new Set(products.map(p => p[`cf_${cf.id}`]).filter(Boolean)));
      options = uniqueVals.map(val => ({ label: val as string, value: val as string }));
    } else if (cf.field_type === 'date') {
      type = "date";
    }

    columns.splice(columns.length - 1, 0, {
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options.length > 0 ? options : undefined,
      visibleByDefault: false,
      render: (product) => {
        const val = product[`cf_${cf.id}`];
        if (!val) return <span className="text-muted-foreground">-</span>;
        if (cf.field_type === 'checkbox') return <span>{val === 'true' ? 'Yes' : 'No'}</span>;
        if (cf.field_type === 'attachment') return <a href={val} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>View</a>;
        return <span>{val}</span>;
      }
    });
  });

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      // Inactive toggle
      if (hideInactive && !product.active) return false;

      // Global search
      if (globalSearch && !product.name?.toLowerCase().includes(globalSearch.toLowerCase()) && !product.sku?.toLowerCase().includes(globalSearch.toLowerCase())) {
        return false;
      }

      // Column filters
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "name") {
          if (!product.name?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "category") {
          if (!product.category?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "sku") {
          if (!product.sku?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "active") {
          const stringActive = product.active ? 'true' : 'false';
          if (!(val as string[]).includes(stringActive)) return false;
        } else if (colId === "created_at") {
          if (!isDateInFilter(product.created_at, val as string | string[])) return false;
        } else if (colId.startsWith("cf_")) {
          const cfVal = product[colId];
          const typeOfCf = customFields.find(f => `cf_${f.id}` === colId)?.field_type;
          
          if (typeOfCf === 'date') {
            if (!isDateInFilter(cfVal, val as string | string[])) return false;
          } else if (typeOfCf === 'dropdown' || typeOfCf === 'radio' || typeOfCf === 'multi-select') {
             if (!(val as string[]).includes(cfVal)) return false;
          } else {
             if (!cfVal?.toLowerCase().includes((val as string).toLowerCase())) return false;
          }
        }
      }
      return true;
    });
  }, [products, filterState, globalSearch, hideInactive, customFields]);

  return (
    <div className="flex h-full flex-col space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your product and service catalog.</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditSettings && (
            <Button variant="outline" onClick={() => setCustomFieldsOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
              <SlidersHorizontal className="size-4 mr-2" /> Custom fields
            </Button>
          )}
          <Button variant="outline" onClick={() => setImportOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
            <Upload className="size-4 mr-2" /> Import
          </Button>
          <Button onClick={() => { setEditProduct(null); setFormOpen(true); }} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="size-4 mr-2" /> New Product
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or SKU..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="pl-9 w-full bg-background border-border"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="hideInactive" 
              checked={hideInactive} 
              onCheckedChange={(checked) => setHideInactive(checked === true)} 
            />
            <label htmlFor="hideInactive" className="text-sm font-medium leading-none text-foreground cursor-pointer">
              Hide inactive
            </label>
          </div>
          
          {selectedProductIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm font-medium mr-2 hidden sm:inline-block">
                {selectedProductIds.size} selected
              </span>
              <Button variant="secondary" size="sm" onClick={() => handleBulkToggleActive(true)} disabled={bulkActionLoading}>
                <CheckCircle className="size-4 mr-2" /> Active
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleBulkToggleActive(false)} disabled={bulkActionLoading}>
                <Ban className="size-4 mr-2" /> Inactive
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkActionLoading}>
                {bulkActionLoading ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />} Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredProducts}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_products_table_columns"
        isLoading={loading}
        rowKey={(product) => product.id}
        onRowClick={(product) => router.push(`/products/${product.id}`)}
        selection={{
          selectedIds: selectedProductIds,
          onSelectAll: (checked) => setSelectedProductIds(checked ? new Set(filteredProducts.map(p => p.id)) : new Set()),
          onSelect: (id, checked) => setSelectedProductIds(prev => {
             const next = new Set(prev);
             if (checked) next.add(id); else next.delete(id);
             return next;
          })
        }}
      />

      <ProductForm open={formOpen} onOpenChange={setFormOpen} product={editProduct} onSaved={fetchProducts} />
      {importOpen && <ImportProductsModal open={importOpen} onOpenChange={setImportOpen} onImported={fetchProducts} />}
      {canEditSettings && <CustomFieldsManager open={customFieldsOpen} onOpenChange={setCustomFieldsOpen} />}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="size-5" /> Delete Product
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>? 
              This will remove the product and all associated custom values. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} className="border-border">Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return;
              setDeleting(true);
              const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id);
              setDeleting(false);
              if (error) toast.error('Failed to delete product');
              else { toast.success('Product deleted'); setDeleteConfirmOpen(false); fetchProducts(); }
            }} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

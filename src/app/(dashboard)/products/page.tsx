'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Product } from '@/types';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
  ChevronLeft,
  ChevronRight,
  Upload,
  Ban,
  CheckCircle,
} from 'lucide-react';
import { ProductForm } from '@/components/products/product-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ImportProductsModal } from '@/components/products/import-products-modal';

const PAGE_SIZE = 25;

export default function ProductsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hideInactive, setHideInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`name.ilike.%${search.trim()}%,sku.ilike.%${search.trim()}%`);
    }

    if (hideInactive) {
      query = query.eq('active', true);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load products');
    } else {
      setProducts(data as Product[] || []);
      setTotalCount(count || 0);
      setSelectedProductIds(new Set());
    }
    setLoading(false);
  }, [supabase, page, search, hideInactive]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setFormOpen(true);
      
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url);
    }
  }, [searchParams]);

  // Handle Search input with debounce
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      fetchProducts();
    }, 400);
    return () => clearTimeout(t);
  }, [search, fetchProducts]);

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedProductIds(new Set(products.map((p) => p.id)));
    } else {
      setSelectedProductIds(new Set());
    }
  }

  function handleSelectProduct(id: string, checked: boolean) {
    const next = new Set(selectedProductIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedProductIds(next);
  }

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">Manage your product and service catalog.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="size-4" />
            Import
          </Button>
          <Button onClick={() => { setEditProduct(null); setFormOpen(true); }} className="gap-2">
            <Plus className="size-4" />
            New Product
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-muted/20 p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full bg-background border-border"
              />
            </div>
            
            <div className="flex items-center space-x-2 mr-auto sm:ml-4 sm:mr-0">
              <Checkbox 
                id="hideInactive" 
                checked={hideInactive} 
                onCheckedChange={(checked) => { setPage(0); setHideInactive(checked === true); }} 
              />
              <label
                htmlFor="hideInactive"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground"
              >
                Hide inactive
              </label>
            </div>
            
            {selectedProductIds.size > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                <span className="text-sm text-muted-foreground mr-2 hidden sm:inline-block">
                  {selectedProductIds.size} selected
                </span>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={() => handleBulkToggleActive(true)}
                  disabled={bulkActionLoading}
                >
                  <CheckCircle className="size-4 mr-2" />
                  Active
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={() => handleBulkToggleActive(false)}
                  disabled={bulkActionLoading}
                >
                  <Ban className="size-4 mr-2" />
                  Inactive
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleBulkDelete}
                  disabled={bulkActionLoading}
                >
                  {bulkActionLoading ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
                  Delete
                </Button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-12 px-4">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary align-middle"
                        checked={selectedProductIds.size === products.length && products.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="min-w-[200px]">Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <Loader2 className="size-6 animate-spin mb-2" />
                          <p>Loading products...</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <p className="text-muted-foreground">No products found.</p>
                        {search && (
                          <Button 
                            variant="link" 
                            onClick={() => setSearch('')}
                            className="mt-2 text-primary"
                          >
                            Clear search
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow 
                        key={product.id} 
                        className="group border-border hover:bg-muted/40 cursor-pointer"
                        onClick={() => router.push(`/products/${product.id}`)}
                      >
                        <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer accent-primary align-middle"
                            checked={selectedProductIds.has(product.id)}
                            onChange={(e) => handleSelectProduct(product.id, e.target.checked)}
                            aria-label={`Select ${product.name}`}
                          />
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.category || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.sku || '—'}
                        </TableCell>
                        <TableCell>
                          {product.price != null ? formatCurrency(product.price, account?.default_currency) : '—'}
                          {product.unit ? <span className="text-muted-foreground text-xs ml-1">/ {product.unit}</span> : ''}
                        </TableCell>
                        <TableCell>
                          {product.active ? (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), "h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity")}>
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40 border-border bg-popover">
                              <DropdownMenuItem onClick={() => { setEditProduct(product); setFormOpen(true); }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-border" />
                              <DropdownMenuItem 
                                className="text-red-500 focus:text-red-600 focus:bg-red-500/10"
                                onClick={() => { setDeleteTarget(product); setDeleteConfirmOpen(true); }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            {/* Pagination */}
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-background/50">
                <p className="text-sm text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{page * PAGE_SIZE + 1}</span> to{' '}
                  <span className="font-medium text-foreground">
                    {Math.min((page + 1) * PAGE_SIZE, totalCount)}
                  </span>{' '}
                  of <span className="font-medium text-foreground">{totalCount}</span> products
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || loading}
                    className="h-8 border-border"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
                    className="h-8 border-border"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ProductForm 
        open={formOpen} 
        onOpenChange={setFormOpen} 
        product={editProduct} 
        onSaved={fetchProducts} 
      />

      {importOpen && (
        <ImportProductsModal
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={fetchProducts}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="size-5" />
              Delete Product
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>? 
              This will remove the product and all associated custom values. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                setDeleting(true);
                const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id);
                setDeleting(false);
                if (error) {
                  toast.error('Failed to delete product');
                } else {
                  toast.success('Product deleted');
                  setDeleteConfirmOpen(false);
                  fetchProducts();
                }
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

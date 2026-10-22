'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Product, CustomField } from '@/types';
import { appendCustomFieldColumns, matchesSearchableCustomFields, getVisibleTableColumns } from '@/lib/custom-fields';
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
  Trash2,
  Loader2,
  Upload,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { ProductForm } from '@/components/products/product-form';
import { Checkbox } from '@/components/ui/checkbox';
import { ImportWizard } from '@/components/import/import-wizard';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from "@/components/shared";
import { inactiveSelection, reactivateDisabledReason } from "@/lib/table/bulk-activation";
import { useCan } from '@/hooks/use-can';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters, applyRangeFilter } from '@/lib/table/apply-filters';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';

/** Stored products fields with no hand-written column, shown via Manage Column. */
const PRODUCT_EXTRA_COLUMNS: readonly ExtraColumnSpec<any>[] = [
      ['description', 'Description', 'text'],
      ['unit', 'Unit', 'text'],
      ['hsn_code', 'HSN Code', 'text'],
      ['min_price', 'Minimum Price', 'currency'],
      ['opening_stock', 'Opening Stock', 'number'],
      ['track_stock', 'Track Stock', 'boolean'],
];

export default function ProductsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, hasPermission } = useAuth();
  const canEditSettings = useCan('edit-settings');
  // Catalogue writes are per-key at the database layer (Module-wise RBAC v1:
  // products RLS requires create_/edit_/delete_products + an agent floor).
  // Gate the UI to match so users only see actions they can actually perform.
  // hasPermission() bypasses for owner/admin and honors {"all":true}.
  const canCreateProducts = hasPermission('create_products');
  const canEditProducts = hasPermission('edit_products');
  const canDeleteProducts = hasPermission('delete_products');
  const canImportProducts = hasPermission('import_products');
  // Any catalogue write capability — used where the older single flag was needed.
  const canManageCatalogue = canCreateProducts || canEditProducts || canDeleteProducts;

  // DataTable state — default filter shows Active products (Inactive/all via the Status column filter).
  const tableView = useTableView("wacrm_products_table_columns", { active: ['true'] });
  const { filterState } = tableView;
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  
  // Lookups
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Custom field definitions: a small, fixed list, loaded once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('module_name', 'product');
      if (alive) setCustomFields(data || []);
    })();
    return () => { alive = false; };
  }, [supabase]);

  /**
   * One page of products, searched and filtered by the database.
   * search_text covers name, sku and searchable custom values; category_name
   * and custom_values are columns on the row (migrations 20261012120000 /
   * 20261012130000), so no embeds and no whole-table custom-value fetch.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('products')
        .select('*, unit_rel:product_units(name, short_name)', { count: 'exact' });

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyTextFilter(q, 'name', filters.name);
      q = applyRangeFilter(q, 'price', filters.price);
      q = applyTextFilter(q, 'category_name', filters.category);
      q = applyTextFilter(q, 'sku', filters.sku);
      q = applyDateFilter(q, 'created_at', filters.created_at);
      q = applyCustomFieldFilters(q, filters, customFields);

      const want = filters.active as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) q = q.eq('active', want[0] === 'true');

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, PRODUCT_EXTRA_COLUMNS);


      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [customFields],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    deps: [cfKey],
  });

  const fetchProducts = table.reload;
  const loading = table.loading;

  const products = useMemo(
    () =>
      table.rows.map((row) => {
        const p = row as Record<string, any>;
        return { ...p, category: p.category_name, ...(p.custom_values ?? {}) };
      }),
    [table.rows],
  );

  const pageIds = useMemo(() => products.map((p) => p.id).join(','), [products]);
  useEffect(() => { setSelectedProductIds(new Set()); }, [pageIds]);

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => {
        const p = r as Record<string, any>;
        return { ...p, category: p.category_name, ...(p.custom_values ?? {}) };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/products/new');
    }
  }, [searchParams, router]);

  async function handleReactivate(product: Product) {
    const { error } = await supabase.from('products').update({ active: true }).eq('id', product.id);
    if (error) toast.error('Failed to re-activate product');
    else { toast.success('Product re-activated'); fetchProducts(); }
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
        /* The thumbnail shrinks to 28px on desktop so it no longer sets the
           row height on its own — the name + description stack does. */
        <div className="flex items-center gap-3 lg:gap-2">
          {product.image ? (
            <img src={product.image} alt={product.name} className="w-10 h-10 lg:w-7 lg:h-7 rounded-md object-cover border border-border" />
          ) : (
            <div className="w-10 h-10 lg:w-7 lg:h-7 rounded-md bg-muted border border-border flex items-center justify-center">
              <span className="text-xs text-muted-foreground lg:text-[9px]">No img</span>
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
      render: (product) => <span className="text-muted-foreground">{product.category_rel?.name || product.category || '—'}</span>
    },
    {
      id: "sku",
      label: "Product Code",
      type: "text",
      render: (product) => <span className="text-muted-foreground">{product.sku || '—'}</span>
    },
    {
      id: "price",
      label: "Price",
      type: "range",
      render: (product) => {
        const unitName = product.unit_rel?.short_name || product.unit_rel?.name || product.unit;
        return (
          <span>
            {product.price != null ? formatCurrency(product.price, account?.default_currency) : '—'}
            {unitName && <span className="text-muted-foreground text-xs ml-1">/ {unitName}</span>}
          </span>
        );
      }
    },
    {
      id: "active",
      label: "Status",
      type: "select",
      options: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      render: (product) => (
        <StatusBadge
          status={product.active ? "active" : "inactive"}
          label={product.active ? "Active" : "Inactive"}
        />
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
      label: "Action",
      visibleByDefault: true,
      render: (product) => {
        const inactive = product.active === false;
        return (
          <RowActions
            editTitle={canEditProducts ? 'Edit' : 'View'}
            onEdit={() => {
              if (canEditProducts) { setEditProduct(product); setFormOpen(true); }
              else { router.push(`/products/${product.id}`); }
            }}
            onDelete={canDeleteProducts ? () => { setDeleteTarget(product); setDeleteConfirmOpen(true); } : undefined}
            onReactivate={canDeleteProducts ? () => handleReactivate(product) : undefined}
            isInactive={inactive}
            deleteTitle="Move to Inactive"
          />
        );
      }
    },
    // The rest of what a product stores, so Manage Column can offer it.
    ...extraColumns<any>(PRODUCT_EXTRA_COLUMNS),
  ];

  // Transform base columns and append custom fields (controlled by admin show_in_table, sortable, filterable flags)
  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, products);
  }, [columns, customFields, products]);

  /** buildQuery already applied the search and every filter. */
  // Products store the soft-delete flag as `active`, not `is_active`.
  const inactiveSelectedIds = useMemo(
    () => inactiveSelection(products, selectedProductIds, (p) => p.id, (p) => (p as { active?: boolean | null }).active),
    [products, selectedProductIds],
  );

  const filteredProducts = products;

  return (
    <PageLayout fill>
      <BulkActionBar
        selectedCount={selectedProductIds.size}
        onClear={() => setSelectedProductIds(new Set())}
        // Two buttons, same pair every other module shows. This used to offer
        // "Active", "Inactive" AND "Move to Inactive", where the last two ran
        // the identical update — three buttons for two outcomes.
        actions={[
          {
            label: "Re-activate",
            icon: <RotateCcw className="size-4" />,
            variant: "outline",
            onClick: () => handleBulkToggleActive(true),
            disabled: bulkActionLoading || inactiveSelectedIds.length === 0,
            title: reactivateDisabledReason(selectedProductIds.size, inactiveSelectedIds.length),
          },
          {
            label: "Move to Inactive",
            icon: <Trash2 className="size-4" />,
            variant: "destructive",
            onClick: () => handleBulkToggleActive(false),
            disabled: bulkActionLoading,
          },
        ]}
      />

      <DataTable
        fill
        columns={visibleColumns}
        data={filteredProducts}
        tableView={tableView}
        isLoading={loading}
        rowKey={(product) => product.id}
        rowHref={(product) => `/products/${product.id}`}
        serverPagination={{ ...table.serverPagination, exportAll }}
        actions={
          canCreateProducts ? (
            <Button
              data-tour="product-add"
              onClick={() => router.push('/products/new')}
              size="sm"
              className="h-7 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium px-2.5"
            >
              <Plus className="size-3.5 mr-1" /> New Product
            </Button>
          ) : null
        }
        menuActions={
          canImportProducts ? (
            <DropdownMenuItem onClick={() => setImportOpen(true)} className="cursor-pointer gap-2">
              <Upload className="size-3.5" />
              Import Products
            </DropdownMenuItem>
          ) : undefined
        }
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
      {importOpen && <ImportWizard open={importOpen} onOpenChange={setImportOpen} module="products" onImported={fetchProducts} />}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="size-5" /> Move Product to Inactive
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Move <span className="font-medium text-foreground">{deleteTarget?.name}</span> to Inactive?
              It will be hidden from the default list but you can re-activate it anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} className="border-border">Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteTarget) return;
              setDeleting(true);
              const { error } = await supabase.from('products').update({ active: false }).eq('id', deleteTarget.id);
              setDeleting(false);
              if (error) toast.error('Failed to deactivate product');
              else { toast.success('Product moved to Inactive'); setDeleteConfirmOpen(false); fetchProducts(); }
            }} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Move to Inactive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

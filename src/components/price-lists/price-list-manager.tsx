"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, ListChecks, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageLayout, PageHeader, EmptyState, StatusBadge, ConfirmDialog, FormPageShell, FormActions } from "@/components/shared";
import {
  getPriceLists, getPriceListWithItems, createPriceList, updatePriceList, deletePriceList, setPriceListActive,
} from "@/lib/price-lists/api";
import type { PriceList, PriceListItem } from "@/lib/price-lists/types";

interface ProductOpt { id: string; name: string; price: number; }

/** Clamp a text field to a valid discount percent (0–100) or null when blank. */
function parsePct(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 0), 100);
}

export function PriceListManager() {
  const supabase = createClient();
  const { account, canEditSettings } = useAuth();
  const accountId = account?.id ?? null;

  const [lists, setLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PriceList | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [blanket, setBlanket] = useState("");
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addPct, setAddPct] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [ls, { data: prods }] = await Promise.all([
        getPriceLists(accountId),
        supabase.from("products").select("id, name, price").eq("account_id", accountId).eq("active", true).order("name"),
      ]);
      setLists(ls);
      setProducts(((prods ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, price: Number(p.price) || 0 })));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load price lists.");
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => { load(); }, [load]);

  const productName = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? "Unknown product";
  }, [products]);

  function openCreate() {
    setEditingId(null);
    setName(""); setBlanket(""); setActive(true); setItems([]);
    setAddProductId(""); setAddPct("");
    setEditorOpen(true);
  }

  async function openEdit(list: PriceList) {
    setEditingId(list.id);
    setName(list.name);
    setBlanket(list.blanket_discount_percent == null ? "" : String(list.blanket_discount_percent));
    setActive(list.active);
    setAddProductId(""); setAddPct("");
    setEditorOpen(true);
    try {
      const full = await getPriceListWithItems(list.id);
      setItems(full.items);
    } catch {
      setItems([]);
      toast.error("Could not load this list's product overrides.");
    }
  }

  function addOverride() {
    if (!addProductId) { toast.error("Pick a product."); return; }
    if (items.some((i) => i.product_id === addProductId)) { toast.error("That product is already overridden."); return; }
    const pct = parsePct(addPct);
    if (pct == null) { toast.error("Enter a discount % (0–100)."); return; }
    setItems((prev) => [...prev, { product_id: addProductId, product_name: productName(addProductId), discount_percent: pct }]);
    setAddProductId(""); setAddPct("");
  }

  function removeOverride(productId: string) {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  }

  async function save() {
    if (!accountId) return;
    if (!name.trim()) { toast.error("Give the price list a name."); return; }
    const blanketVal = parsePct(blanket);
    setSaving(true);
    try {
      const input = {
        name,
        blanket_discount_percent: blanketVal,
        active,
        items: items.map((i) => ({ product_id: i.product_id, discount_percent: i.discount_percent })),
      };
      if (editingId) {
        await updatePriceList(editingId, input);
        toast.success("Price list updated.");
      } else {
        await createPriceList(accountId, input);
        toast.success("Price list created.");
      }
      setEditorOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the price list.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(list: PriceList) {
    try {
      await setPriceListActive(list.id, !list.active);
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, active: !l.active } : l)));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the price list.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deletePriceList(deleteTarget.id);
      toast.success("Price list deleted.");
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete the price list.");
    }
  }

  const availableProducts = products.filter((p) => !items.some((i) => i.product_id === p.id));

  // Full-page create/edit — same shell (FormPageShell) and width as every other
  // master's create/edit screen, replacing the old dialog.
  if (editorOpen) {
    return (
      <FormPageShell
        icon={ListChecks}
        title={editingId ? "Edit Price List" : "New Price List"}
        subtitle="A blanket discount applies to every product. Per-product overrides beat the blanket; everything else stays at catalogue price."
        onBack={() => setEditorOpen(false)}
        width="none"
        footer={
          <FormActions
            onCancel={() => setEditorOpen(false)}
            onSave={save}
            saving={saving}
            saveDisabled={!canEditSettings}
            saveLabel={editingId ? "Save Changes" : "Create Price List"}
          />
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="pl-name">Name</Label>
              <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wholesale, Key Accounts" disabled={!canEditSettings} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 h-10">
              <span className="text-sm font-medium">Active</span>
              <Switch checked={active} onCheckedChange={setActive} disabled={!canEditSettings} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pl-blanket">Blanket discount %</Label>
              <Input id="pl-blanket" type="number" min="0" max="100" step="0.01" value={blanket}
                onChange={(e) => setBlanket(e.target.value)} placeholder="e.g. 10 (blank = none)" disabled={!canEditSettings} />
              <p className="text-xs text-muted-foreground">Applied to every product unless overridden below.</p>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <Label>Per-product overrides</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional. These products get their own discount instead of the blanket. Everything not listed stays at catalogue price.
              </p>
            </div>
            {items.length > 0 && (
              <div className="rounded-lg border border-border divide-y max-w-2xl">
                {items.map((it) => (
                  <div key={it.product_id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{it.product_name || productName(it.product_id)}</span>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums font-medium">{it.discount_percent}%</span>
                      {canEditSettings && (
                        <button type="button" onClick={() => removeOverride(it.product_id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {canEditSettings && (
              <div className="flex items-end gap-2 max-w-2xl">
                <div className="grid gap-1 flex-1">
                  <span className="text-xs text-muted-foreground">Product</span>
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Select a product…</option>
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1 w-28">
                  <span className="text-xs text-muted-foreground">Discount %</span>
                  <Input type="number" min="0" max="100" step="0.01" value={addPct} onChange={(e) => setAddPct(e.target.value)} placeholder="%" />
                </div>
                <Button type="button" variant="outline" onClick={addOverride}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            )}
            {products.length === 0 && (
              <p className="text-xs text-muted-foreground">No active products to override yet.</p>
            )}
          </div>
        </div>
      </FormPageShell>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Price Lists"
        subtitle="Customer-specific pricing. Assign a list to a customer on their page; its prices apply automatically on web and mobile orders."
        actions={canEditSettings ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New price list
          </Button>
        ) : undefined}
      />

      {loading ? (
        <div className="p-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : lists.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No price lists yet"
          description="Create a price list to give a set of customers a blanket discount and/or per-product rates."
          action={canEditSettings ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> New price list
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Blanket discount</TableHead>
                <TableHead className="text-right">Product overrides</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[1%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.blanket_discount_percent == null ? "—" : `${Number(l.blanket_discount_percent)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.item_count ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.customer_count ?? 0}</TableCell>
                  <TableCell>
                    <StatusBadge status={l.active ? "Active" : "Inactive"} variant={l.active ? "success" : "neutral"} />
                  </TableCell>
                  <TableCell>
                    {canEditSettings && (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => toggleActive(l)}>
                          {l.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(l)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(l)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Customers on this list will fall back to catalogue pricing. Existing orders keep the prices they were saved with."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
      />
    </PageLayout>
  );
}

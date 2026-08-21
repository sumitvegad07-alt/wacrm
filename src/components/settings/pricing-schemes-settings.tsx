"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Percent, ShieldCheck, Tag, Wand2, Boxes } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { allowedModules } from "@/lib/plans/catalog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ProductCategoriesSettings } from "./product-categories-settings";
import { ProductUnitsSettings } from "./product-units-settings";

/**
 * Settings -> Pricing & Schemes.
 *
 * One page. Each toggle expands its own options inline rather than sending the
 * admin off to another screen — the founder's explicit ask, because bouncing
 * between settings pages to configure one idea is how this gets abandoned.
 *
 * ASSIGNMENT deliberately does NOT live here: a customer's price list and level
 * are set on the customer's own page, and a product's tax slab on the product.
 * Settings defines the options; the work happens where the record is.
 */

interface TaxSlab {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
  position: number;
}

type DiscountMode = "off" | "item" | "order" | "both";

const DISCOUNT_MODES: { value: DiscountMode; label: string; help: string }[] = [
  { value: "off", label: "Off", help: "Salesmen cannot discount at all." },
  { value: "item", label: "Per item", help: "A discount on individual order lines." },
  { value: "order", label: "Whole order", help: "One discount across the whole order." },
  { value: "both", label: "Both", help: "Line discounts and a whole-order discount." },
];

// How a discount is entered — independent of scope. Unlike tax mode this is
// NOT locked or stored per order: changing it only governs what a salesman may
// enter on FUTURE orders; past orders already stored a fixed discount value.
type DiscountValueType = "percent" | "amount" | "both";
const DISCOUNT_VALUE_TYPES: { value: DiscountValueType; label: string; help: string }[] = [
  { value: "percent", label: "Percentage", help: "Discounts entered as a %." },
  { value: "amount", label: "Amount", help: "Discounts entered as a fixed amount." },
  { value: "both", label: "Both", help: "Salesman picks % or amount (one at a time)." },
];

export function PricingSchemesSettings() {
  const supabase = createClient();
  const { accountId, account, canEditSettings, moduleSettings, refreshModuleSettings } = useAuth();

  // Scheme Management is an opt-in module gated from here. The main-menu link
  // and the /schemes route both key off module_settings.scheme.
  const planAllowsScheme = allowedModules(account?.subscription_plan).has("scheme");
  const [schemeEnabled, setSchemeEnabled] = useState(false);
  const [schemeSaving, setSchemeSaving] = useState(false);

  useEffect(() => {
    setSchemeEnabled(!!moduleSettings?.scheme);
  }, [moduleSettings?.scheme]);

  async function toggleScheme(on: boolean) {
    setSchemeSaving(true);
    setSchemeEnabled(on); // optimistic
    try {
      const res = await fetch("/api/account/module-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheme: on }),
      });
      if (!res.ok) throw new Error("save failed");
      await refreshModuleSettings();
      toast.success(on ? "Scheme Management enabled" : "Scheme Management disabled");
    } catch {
      setSchemeEnabled(!on); // revert
      toast.error("Could not update Scheme Management");
    } finally {
      setSchemeSaving(false);
    }
  }

  // Stock Management — opt-in module, gated from here exactly like Scheme.
  const planAllowsStock = allowedModules(account?.subscription_plan).has("stock");
  const [stockEnabled, setStockEnabled] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);

  useEffect(() => {
    setStockEnabled(!!moduleSettings?.stock);
  }, [moduleSettings?.stock]);

  async function toggleStock(on: boolean) {
    setStockSaving(true);
    setStockEnabled(on); // optimistic
    try {
      const res = await fetch("/api/account/module-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock: on }),
      });
      if (!res.ok) throw new Error("save failed");
      await refreshModuleSettings();
      toast.success(on ? "Stock Management enabled" : "Stock Management disabled");
    } catch {
      setStockEnabled(!on); // revert
      toast.error("Could not update Stock Management");
    } finally {
      setStockSaving(false);
    }
  }

  const [loading, setLoading] = useState(true);
  const [slabs, setSlabs] = useState<TaxSlab[]>([]);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [productsWithoutSlab, setProductsWithoutSlab] = useState(0);

  const [discountMode, setDiscountMode] = useState<DiscountMode>("off");
  const [discountValueType, setDiscountValueType] = useState<DiscountValueType>("both");
  const [taxMode, setTaxMode] = useState<"exclusive" | "inclusive">("exclusive");
  const [enforceFloor, setEnforceFloor] = useState(true);
  const [saving, setSaving] = useState(false);

  // Stock behaviour (accounts.settings.stock_settings). Saved with the main
  // Save button; the module on/off toggle above is immediate via the API.
  type StockOutEvent = "order_created" | "order_closed" | "dispatch";
  const [stockOutEvent, setStockOutEvent] = useState<StockOutEvent>("order_closed");
  const [restrictInsufficient, setRestrictInsufficient] = useState(false);
  
  // Lifted from ProductCategoriesSettings
  const [levelsCount, setLevelsCount] = useState<1 | 2 | 3>(1);
  const [level1Name, setLevel1Name] = useState("Category");
  const [level2Name, setLevel2Name] = useState("Sub-Category");
  const [level3Name, setLevel3Name] = useState("Brand");
  
  const [hasChanges, setHasChanges] = useState(false);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [slabRes, acctRes, prodRes] = await Promise.all([
      supabase.from("tax_slabs").select("id, name, rate, is_default, position").eq("account_id", accountId).order("position").order("rate"),
      supabase.from("accounts").select("settings").eq("id", accountId).single(),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("account_id", accountId).is("tax_slab_id", null),
    ]);

    if (slabRes.error) toast.error("Could not load tax slabs");
    setSlabs((slabRes.data as TaxSlab[]) ?? []);
    setProductsWithoutSlab(prodRes.count ?? 0);

    const os = acctRes.data?.settings?.order_settings ?? {};
    setDiscountMode((os.discount_mode as DiscountMode) ?? "off");
    setDiscountValueType((os.discount_value_type as DiscountValueType) ?? "both");
    setTaxMode((os.tax_mode as "exclusive" | "inclusive") ?? "exclusive");
    setEnforceFloor(os.enforce_price_floor !== false); // default on

    const ss = acctRes.data?.settings?.stock_settings ?? {};
    setStockOutEvent((ss.stock_out_event as StockOutEvent) ?? "order_closed");
    setRestrictInsufficient(ss.restrict_on_insufficient === true);

    const ps = acctRes.data?.settings?.product_settings ?? {};
    setLevelsCount(ps.levels_count || 1);
    setLevel1Name(ps.level_1_name || "Category");
    setLevel2Name(ps.level_2_name || "Sub-Category");
    setLevel3Name(ps.level_3_name || "Brand");
    
    setHasChanges(false);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  /** Save all settings explicitly. */
  async function saveAllSettings() {
    if (!accountId) return;
    setSaving(true);
    const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const settings = acct?.settings ?? {};
    
    const newSettings = {
      ...settings,
      order_settings: {
        ...(settings.order_settings ?? {}),
        discount_mode: discountMode,
        tax_mode: taxMode,
        enforce_price_floor: enforceFloor,
      },
      stock_settings: {
        ...(settings.stock_settings ?? {}),
        stock_out_event: stockOutEvent,
        restrict_on_insufficient: restrictInsufficient,
      },
      product_settings: {
        ...(settings.product_settings ?? {}),
        levels_count: levelsCount,
        level_1_name: level1Name,
        level_2_name: level2Name,
        level_3_name: level3Name,
      }
    };
    
    const { error } = await supabase
      .from("accounts")
      .update({ settings: newSettings })
      .eq("id", accountId);
      
    setSaving(false);
    if (error) { toast.error("Could not save settings"); return; }
    toast.success("Settings saved successfully");
    setHasChanges(false);
  }

  async function handleAddSlab(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !newName.trim()) return;
    const rate = Number(newRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }
    setIsAdding(true);
    const { error } = await supabase.from("tax_slabs").insert({
      account_id: accountId,
      name: newName.trim(),
      rate,
      position: slabs.length,
    });
    setIsAdding(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That slab name already exists" : "Could not add slab");
      return;
    }
    setNewName("");
    setNewRate("");
    toast.success("Tax slab added");
    loadData();
  }

  async function handleDeleteSlab(slab: TaxSlab) {
    if (!confirm(`Remove "${slab.name}"? Products using it will fall back to no tax until you pick another slab. Existing orders keep the rate they were saved with.`)) return;
    const { error } = await supabase.from("tax_slabs").delete().eq("id", slab.id);
    if (error) { toast.error("Could not delete slab"); return; }
    toast.success("Deleted");
    loadData();
  }

  /**
   * Explicit, admin-triggered backfill. Deliberately NOT done by the migration:
   * silently retro-taxing a live catalogue is not a decision a schema change
   * should make on someone's behalf.
   */
  async function assignSlabToAllProducts(slab: TaxSlab) {
    if (!accountId) return;
    if (!confirm(`Set every product without a tax slab to "${slab.name}" (${slab.rate}%)?\n\nThis affects ${productsWithoutSlab} product${productsWithoutSlab === 1 ? "" : "s"}. Products that already have a slab are left alone. Existing orders are unaffected.`)) return;
    setAssigning(true);
    const { error } = await supabase
      .from("products")
      .update({ tax_slab_id: slab.id })
      .eq("account_id", accountId)
      .is("tax_slab_id", null);
    setAssigning(false);
    if (error) { toast.error("Could not assign slab"); return; }
    toast.success(`Applied "${slab.name}" to ${productsWithoutSlab} product${productsWithoutSlab === 1 ? "" : "s"}`);
    loadData();
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <div className="flex items-center justify-end mb-4">
        <Button onClick={saveAllSettings} disabled={!hasChanges || saving} className="shadow-sm">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Settings
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        <div className="space-y-8">
          {/* ---------------- Tax slabs ---------------- */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Tax slabs</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Define the rates you charge. Each product picks one. An order line stores the
              rate it was sold at, so changing a slab never rewrites past orders.
            </p>

            {canEditSettings && (
              <form onSubmit={handleAddSlab} className="flex items-end gap-3 p-4 border border-border rounded-lg bg-muted/30">
                <div className="grid gap-2 flex-1">
                  <Label>Name</Label>
                  <Input required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Standard 18%" />
                </div>
                <div className="grid gap-2 w-28">
                  <Label>Rate %</Label>
                  <Input required type="number" step="0.01" min="0" max="100" value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="18" />
                </div>
                <Button type="submit" disabled={isAdding}>
                  {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
                </Button>
              </form>
            )}

            {slabs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                No tax slabs yet. Add one above — products will show a tax dropdown once at least one exists.
              </div>
            ) : (
              <div className="space-y-2">
                {slabs.map((slab) => (
                  <div key={slab.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
                    <span className="font-medium text-sm flex items-center gap-2">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      {slab.name}
                      <span className="text-muted-foreground font-normal tabular-nums">{Number(slab.rate)}%</span>
                    </span>
                    {canEditSettings && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={assigning}
                          onClick={() => assignSlabToAllProducts(slab)}
                          title="Assign this slab to all products that currently have no tax slab"
                          className="h-8 text-xs"
                        >
                          Apply to all untaxed
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSlab(slab)}
                          className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------------- Tax mode ---------------- */}
          <div className="space-y-3 pt-6 border-t border-border">
            <div>
              <h3 className="text-sm font-semibold">Product prices are</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Whether the price you set on a product already includes tax, or tax is added on top at
                order time. Each order records the mode it used, so changing this never alters past orders.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
              {([
                { value: "exclusive", label: "Exclusive of tax", help: "Price is pre-tax; tax is added on top." },
                { value: "inclusive", label: "Inclusive of tax", help: "Price already contains the tax." },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={!canEditSettings || saving}
                  onClick={() => { setTaxMode(m.value); setHasChanges(true); }}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    taxMode === m.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.help}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* ---------------- Discounts ---------------- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Salesman discounts</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Off means the discount field never appears in either app.
                </p>
              </div>
              <Switch
                checked={discountMode !== "off"}
                disabled={!canEditSettings || saving}
                onCheckedChange={(on) => {
                  const next: DiscountMode = on ? "item" : "off";
                  setDiscountMode(next);
                  setHasChanges(true);
                }}
              />
            </div>

            {discountMode !== "off" && (
              <div className="space-y-3 pl-6 border-l-2 border-primary/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Order-level discount</p>
                    <p className="text-xs text-muted-foreground">
                      Allow a flat or percentage discount across the whole order, in addition to line discounts.
                    </p>
                  </div>
                  <Switch
                    checked={discountMode === "both"}
                    disabled={!canEditSettings || saving}
                    onCheckedChange={(on) => {
                      const next: DiscountMode = on ? "both" : "item";
                      setDiscountMode(next);
                      setHasChanges(true);
                    }}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Who may actually discount is controlled per role by the{" "}
                  <span className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">apply_order_discount</span>{" "}
                  permission under Team → Roles. Without it the field stays hidden even when this is on.
                </p>
              </div>
            )}
          </div>

          {/* ---------------- Price floor ---------------- */}
          <div className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold">Enforce price floor</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Blocks any order that would sell a product below its minimum price, however
                    the discounts stack up. Set the minimum on each product.
                  </p>
                </div>
              </div>
              <Switch
                checked={enforceFloor}
                disabled={!canEditSettings || saving}
                onCheckedChange={(on) => { setEnforceFloor(on); setHasChanges(true); }}
              />
            </div>
            {!enforceFloor && (
              <p className="text-xs text-amber-600 dark:text-amber-500 pl-6">
                With this off, stacked discounts can take a price below cost and the order will still save.
              </p>
            )}
          </div>

          {/* ---------------- Scheme Management ---------------- */}
          <div className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Scheme Management</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Quantity slabs, free goods and order-value discounts, suggested to the
                  salesman at order entry. Turn this on to show <strong>Scheme</strong> in the
                  main menu; off keeps it hidden for everyone.
                </p>
              </div>
              <Switch
                checked={schemeEnabled}
                disabled={!canEditSettings || !planAllowsScheme || schemeSaving}
                onCheckedChange={toggleScheme}
              />
            </div>

            {!planAllowsScheme && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Your current plan doesn&apos;t include Scheme Management. Contact us to upgrade.
              </p>
            )}

            {schemeEnabled && planAllowsScheme && (
              <div className="pl-6 border-l-2 border-primary/20">
                <Link href="/schemes" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Tag className="h-4 w-4 mr-1" /> Manage schemes
                </Link>
              </div>
            )}
          </div>

          {/* ---------------- Stock Management ---------------- */}
          <div className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold">Enable Stock Management</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Track closing stock per product, automatically — the way outstanding is
                    calculated for customers. Turn this on to show <strong>Stock</strong> in the
                    main menu, closing stock on the order form, and the Stock report; off keeps it
                    hidden for everyone.
                  </p>
                </div>
              </div>
              <Switch
                checked={stockEnabled}
                disabled={!canEditSettings || !planAllowsStock || stockSaving}
                onCheckedChange={toggleStock}
              />
            </div>

            {!planAllowsStock && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Your current plan doesn&apos;t include Stock Management. Contact us to upgrade.
              </p>
            )}

            {stockEnabled && planAllowsStock && (
              <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                {/* Stock-out event */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Reduce stock when</p>
                  <p className="text-xs text-muted-foreground">
                    Which event depletes a product&apos;s stock. Changing this affects future
                    documents only — stock already moved keeps its original basis.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {([
                      { value: "order_created", label: "An order is created", help: "Stock commits the moment a salesman books an order (Cancelled/Rejected orders release it back)." },
                      { value: "order_closed", label: "An order is Closed", help: "Mirrors how outstanding counts Closed orders. Recommended." },
                      { value: "dispatch", label: "Goods are dispatched", help: "Stock drops only when goods physically leave (per dispatch). Most accurate to reality." },
                    ] as const).map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        disabled={!canEditSettings || saving}
                        onClick={() => { setStockOutEvent(m.value); setHasChanges(true); }}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          stockOutEvent === m.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                        }`}
                      >
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.help}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Restrict on insufficient stock */}
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <p className="text-sm font-medium">Block orders that exceed stock</p>
                    <p className="text-xs text-muted-foreground">
                      When on, an order line whose quantity is more than the available closing
                      stock cannot be saved. Off shows the stock but never blocks.
                    </p>
                  </div>
                  <Switch
                    checked={restrictInsufficient}
                    disabled={!canEditSettings || saving}
                    onCheckedChange={(on) => { setRestrictInsufficient(on); setHasChanges(true); }}
                  />
                </div>

                <div>
                  <Link href="/stock" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <Boxes className="h-4 w-4 mr-1" /> Manage stock
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ProductCategoriesSettings
        levelsCount={levelsCount}
        setLevelsCount={(val) => { setLevelsCount(val); setHasChanges(true); }}
        level1Name={level1Name}
        setLevel1Name={(val) => { setLevel1Name(val); setHasChanges(true); }}
        level2Name={level2Name}
        setLevel2Name={(val) => { setLevel2Name(val); setHasChanges(true); }}
        level3Name={level3Name}
        setLevel3Name={(val) => { setLevel3Name(val); setHasChanges(true); }}
      />
      <ProductUnitsSettings />
    </section>
  );
}

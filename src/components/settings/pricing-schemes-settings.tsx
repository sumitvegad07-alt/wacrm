"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Percent, ShieldCheck, Tag, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "./settings-panel-head";

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

export function PricingSchemesSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [slabs, setSlabs] = useState<TaxSlab[]>([]);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [productsWithoutSlab, setProductsWithoutSlab] = useState(0);

  const [discountMode, setDiscountMode] = useState<DiscountMode>("off");
  const [enforceFloor, setEnforceFloor] = useState(true);
  const [saving, setSaving] = useState(false);

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
    setEnforceFloor(os.enforce_price_floor !== false); // default on
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  /** Merge a patch into accounts.settings.order_settings without clobbering siblings. */
  async function patchOrderSettings(patch: Record<string, unknown>) {
    if (!accountId) return;
    setSaving(true);
    const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const settings = acct?.settings ?? {};
    const orderSettings = settings.order_settings ?? {};
    const { error } = await supabase
      .from("accounts")
      .update({ settings: { ...settings, order_settings: { ...orderSettings, ...patch } } })
      .eq("id", accountId);
    setSaving(false);
    if (error) { toast.error("Could not save"); return; }
    toast.success("Saved");
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
    <section className="max-w-3xl space-y-8 animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Pricing & Schemes"
        description="Tax slabs, salesman discounts and price protection. Assign a slab to a product on the product itself, and a price list to a customer on the customer's page."
      />

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
                    {productsWithoutSlab > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => assignSlabToAllProducts(slab)}
                        disabled={assigning}
                        title={`Apply to the ${productsWithoutSlab} product(s) that have no slab yet`}
                      >
                        {assigning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wand2 className="h-3 w-3 mr-1" />}
                        Apply to {productsWithoutSlab} unset
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteSlab(slab)} className="text-red-400 hover:text-red-500 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {productsWithoutSlab > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {productsWithoutSlab} product{productsWithoutSlab === 1 ? " has" : "s have"} no tax slab and will be taxed at 0%.
                Set them individually on each product, or use “Apply to unset” above.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---------------- Discounts ---------------- */}
      <div className="space-y-3 pt-6 border-t border-border">
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
              patchOrderSettings({ discount_mode: next });
            }}
          />
        </div>

        {discountMode !== "off" && (
          <div className="space-y-3 pl-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {DISCOUNT_MODES.filter((m) => m.value !== "off").map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  disabled={!canEditSettings || saving}
                  onClick={() => { setDiscountMode(mode.value); patchOrderSettings({ discount_mode: mode.value }); }}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    discountMode === mode.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{mode.help}</p>
                </button>
              ))}
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
            onCheckedChange={(on) => { setEnforceFloor(on); patchOrderSettings({ enforce_price_floor: on }); }}
          />
        </div>
        {!enforceFloor && (
          <p className="text-xs text-amber-600 dark:text-amber-500 pl-6">
            With this off, stacked discounts can take a price below cost and the order will still save.
          </p>
        )}
      </div>

      {/* ---------------- Schemes (not built yet) ---------------- */}
      <div className="space-y-2 pt-6 border-t border-border opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Schemes</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Quantity slabs, free goods and value slabs.
            </p>
          </div>
          <Switch checked={false} disabled />
        </div>
        <p className="text-xs text-muted-foreground">
          Not built yet — the database is ready but there is no scheme configuration or
          calculation behind this switch, so it stays off rather than pretending to work.
        </p>
      </div>
    </section>
  );
}

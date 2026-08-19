"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Tag, Trash2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  createScheme,
  getCustomerOptions,
  getProductOptions,
  getScheme,
  updateScheme,
} from "@/lib/schemes/api";
import {
  REWARD_TYPE_LABELS,
  SCHEME_TYPE_LABELS,
  rewardTypesFor,
  usesValueBounds,
  type CustomerOption,
  type ProductOption,
  type SchemeFormValues,
  type SchemeRewardType,
  type SchemeSlabRow,
  type SchemeType,
} from "@/lib/schemes/types";

const SCHEME_TYPE_HELP: Record<SchemeType, string> = {
  quantity_slab:
    "Buy more of a product, earn a better deal on it. You set quantity bands (e.g. 10–19, 20+) and a reward for each band. The reward can be a % discount, a ₹ amount off each unit, or a fixed special price.",
  free_goods:
    "Buy a product and get units of another product (or the same one) free. The reward is always free goods — you choose which product is given and how many.",
  value_slab:
    "Reward the whole order once it crosses a rupee value (e.g. over ₹50,000). The reward is a % discount or a flat ₹ amount off the order.",
};

const REWARD_HELP: Record<SchemeType, string> = {
  quantity_slab: "% discount, ₹ off each unit, or a special per-unit price.",
  free_goods: "Free goods only — pick the free product and quantity in each band below.",
  value_slab: "% discount or a flat ₹ amount off the order.",
};

const SLAB_MODE_LABELS: Record<"step_up" | "repeat", string> = {
  step_up: "Best band reached (tiered)",
  repeat: "Repeats per set",
};

const SLAB_MODE_HELP: Record<"step_up" | "repeat", string> = {
  step_up:
    "Best band reached — the customer gets the single highest band their quantity qualifies for. Example: 10–19 → 1 free, 20+ → 3 free. Buying 25 gives 3 free (the 20+ band), not 4.",
  repeat:
    "Repeats per set — the reward repeats for every complete set. Example: “every 10 → 1 free”. Buying 25 gives 2 free (two full sets of 10; the leftover 5 earns nothing).",
};

const TARGET_LABELS: Record<"all" | "specific_customers", string> = {
  all: "All customers",
  specific_customers: "Specific customers",
};

interface SlabDraft {
  lo: string;
  hi: string;
  rewardValue: string;
  freeProductId: string | null;
  freeQty: string;
}

interface Props {
  asPage?: boolean;
  /** Edit an existing scheme. */
  schemeId?: string;
  /** Prefill from an existing scheme but save as a NEW one (Duplicate). */
  cloneFromId?: string;
  open?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const emptySlab = (): SlabDraft => ({ lo: "", hi: "", rewardValue: "", freeProductId: null, freeQty: "" });

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function SchemeForm({ asPage = false, schemeId, cloneFromId, open = true, onClose, onSaved }: Props) {
  const { account } = useAuth();
  const accountId = account?.id ?? null;
  const isEdit = !!schemeId;
  const sourceId = schemeId ?? cloneFromId ?? null;

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  const [name, setName] = useState("");
  const [schemeType, setSchemeType] = useState<SchemeType>("quantity_slab");
  const [slabMode, setSlabMode] = useState<"step_up" | "repeat">("step_up");
  const [rewardType, setRewardType] = useState<SchemeRewardType>("discount_percent");
  const [targetType, setTargetType] = useState<"all" | "specific_customers">("all");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [priority, setPriority] = useState("0");
  const [startsOn, setStartsOn] = useState(todayISO());
  const [endsOn, setEndsOn] = useState("");
  const [maxFree, setMaxFree] = useState("");
  const [active, setActive] = useState(true);
  const [slabs, setSlabs] = useState<SlabDraft[]>([emptySlab()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [p, c] = await Promise.all([getProductOptions(accountId), getCustomerOptions(accountId)]);
      setProducts(p);
      setCustomers(c);
      if (sourceId) {
        const s = await getScheme(accountId, sourceId);
        if (!s) {
          toast.error("Scheme not found.");
          onClose();
          return;
        }
        const useValue = usesValueBounds(s.scheme_type);
        setName(cloneFromId ? `${s.name} (copy)` : s.name);
        setSchemeType(s.scheme_type);
        setSlabMode(s.slab_mode);
        setRewardType(s.scheme_type === "free_goods" ? "free_goods" : (s.slabs[0]?.reward_type ?? rewardTypesFor(s.scheme_type)[0]));
        setTargetType(s.target_type);
        setProductIds(s.productIds);
        setCustomerIds(s.customerIds);
        setPriority(String(s.priority));
        setStartsOn(cloneFromId ? todayISO() : s.starts_on);
        setEndsOn(cloneFromId ? "" : (s.ends_on ?? ""));
        setMaxFree(s.max_free_units_per_order != null ? String(s.max_free_units_per_order) : "");
        setActive(cloneFromId ? true : s.active);
        setSlabs(
          (s.slabs.length ? s.slabs : [null]).map((slab): SlabDraft => {
            if (!slab) return emptySlab();
            return {
              lo: String((useValue ? slab.min_value : slab.min_qty) ?? ""),
              hi: (useValue ? slab.max_value : slab.max_qty) == null ? "" : String(useValue ? slab.max_value : slab.max_qty),
              rewardValue: slab.reward_value == null ? "" : String(slab.reward_value),
              freeProductId: slab.free_product_id,
              freeQty: slab.free_qty == null ? "" : String(slab.free_qty),
            };
          }),
        );
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [accountId, sourceId, cloneFromId, onClose]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const allowed = rewardTypesFor(schemeType);
    setRewardType((rt) => (allowed.includes(rt) ? rt : allowed[0]));
  }, [schemeType]);

  const useValue = usesValueBounds(schemeType);
  const isFreeGoods = rewardType === "free_goods";
  const boundLabel = useValue ? "order ₹" : "qty";

  const productOptions = useMemo(() => products.map((p) => ({ label: `${p.name} (₹${p.price})`, value: p.id })), [products]);
  const customerOptions = useMemo(() => customers.map((c) => ({ label: c.label, value: c.id })), [customers]);
  const productItems = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products]);

  const setSlab = (i: number, patch: Partial<SlabDraft>) =>
    setSlabs((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  function fail(msg: string): null { setError(msg); return null; }

  function validateAndBuild(): SchemeFormValues | null {
    if (!name.trim()) return fail("Give the scheme a name.");
    if (!startsOn) return fail("Set a start date.");
    if (endsOn && endsOn < startsOn) return fail("End date can't be before the start date.");
    if (slabs.length === 0) return fail("Add at least one band.");

    const builtSlabs: SchemeSlabRow[] = [];
    for (let i = 0; i < slabs.length; i++) {
      const s = slabs[i];
      const lo = toNum(s.lo);
      const hi = toNum(s.hi);
      if (lo === null || lo < 0) return fail(`Band ${i + 1}: enter a valid lower ${boundLabel}.`);
      if (hi !== null && hi < lo) return fail(`Band ${i + 1}: upper ${boundLabel} is below the lower.`);

      let reward_value: number | null = null;
      let free_product_id: string | null = null;
      let free_qty: number | null = null;

      if (isFreeGoods) {
        if (!s.freeProductId) return fail(`Band ${i + 1}: choose the free product.`);
        const fq = toNum(s.freeQty);
        if (fq === null || fq <= 0) return fail(`Band ${i + 1}: enter a free quantity above 0.`);
        free_product_id = s.freeProductId;
        free_qty = fq;
      } else {
        const rv = toNum(s.rewardValue);
        if (rv === null || rv <= 0) return fail(`Band ${i + 1}: enter a reward value above 0.`);
        reward_value = rv;
      }

      builtSlabs.push({
        min_qty: useValue ? null : lo,
        max_qty: useValue ? null : hi,
        min_value: useValue ? lo : null,
        max_value: useValue ? hi : null,
        reward_type: rewardType,
        reward_value,
        free_product_id,
        free_qty,
      });
    }

    if (schemeType !== "value_slab" && productIds.length === 0)
      return fail("Pick at least one product this scheme applies to.");
    if (targetType === "specific_customers" && customerIds.length === 0)
      return fail("Pick the customers this scheme is limited to, or target everyone.");

    return {
      name: name.trim(),
      schemeType,
      slabMode: useValue ? "step_up" : slabMode,
      targetType,
      maxFreeUnitsPerOrder: isFreeGoods ? toNum(maxFree) : null,
      priority: toNum(priority) ?? 0,
      startsOn,
      endsOn: endsOn || null,
      active,
      productIds,
      customerIds: targetType === "specific_customers" ? customerIds : [],
      slabs: builtSlabs,
    };
  }

  async function handleSave() {
    if (!accountId) return;
    const values = validateAndBuild();
    if (!values) return;
    setSaving(true);
    try {
      if (isEdit && schemeId) {
        await updateScheme(accountId, schemeId, values);
        toast.success("Scheme updated.");
      } else {
        await createScheme(accountId, values);
        toast.success(cloneFromId ? "Scheme duplicated." : "Scheme created.");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const body = loading ? (
    <div className="flex items-center justify-center py-20 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
    </div>
  ) : (
    <div className="space-y-6">
      {/* 1. Name */}
      <div className="space-y-1.5">
        <Label>Scheme name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali — Buy 10 get 1" />
      </div>

      {/* 2-3. Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Start date</Label>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End date (optional)</Label>
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>

      {/* 4. Type */}
      <div className="space-y-1.5">
        <Label>Scheme type</Label>
        <Select value={schemeType} items={SCHEME_TYPE_LABELS} onValueChange={(v) => setSchemeType(v as SchemeType)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SCHEME_TYPE_LABELS) as SchemeType[]).map((t) => (
              <SelectItem key={t} value={t}>{SCHEME_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground flex gap-1.5 pt-1">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {SCHEME_TYPE_HELP[schemeType]}
        </p>
      </div>

      {/* 5-6. Reward + how bands apply */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Reward</Label>
          <Select value={rewardType} items={REWARD_TYPE_LABELS} onValueChange={(v) => setRewardType(v as SchemeRewardType)} disabled={schemeType === "free_goods"}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {rewardTypesFor(schemeType).map((rt) => (
                <SelectItem key={rt} value={rt}>{REWARD_TYPE_LABELS[rt]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{REWARD_HELP[schemeType]}</p>
        </div>

        {!useValue && (
          <div className="space-y-1.5">
            <Label>How bands apply</Label>
            <Select value={slabMode} items={SLAB_MODE_LABELS} onValueChange={(v) => setSlabMode(v as "step_up" | "repeat")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="step_up">{SLAB_MODE_LABELS.step_up}</SelectItem>
                <SelectItem value="repeat">{SLAB_MODE_LABELS.repeat}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SLAB_MODE_HELP[slabMode]}</p>
          </div>
        )}
      </div>

      {/* 7. Max free units */}
      {isFreeGoods && !useValue && (
        <div className="space-y-1.5">
          <Label>Max free units per order</Label>
          <Input type="number" value={maxFree} onChange={(e) => setMaxFree(e.target.value)} placeholder="Blank = no cap" />
          <p className="text-xs text-muted-foreground">A ceiling on total free units this scheme can give on one order.</p>
        </div>
      )}

      {/* 8. Bands */}
      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center justify-between">
          <div>
            <Label>{useValue ? "Order-value bands" : "Quantity bands"}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {useValue ? "Each band is an order-value range and the discount it earns." : "Each band is a quantity range and the reward it earns."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setSlabs((p) => [...p, emptySlab()])}>
            <Plus className="h-4 w-4 mr-1" /> Add new band
          </Button>
        </div>

        <div className="space-y-2">
          {slabs.map((s, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[120px] space-y-1">
                  <Label className="text-xs">Min {boundLabel}</Label>
                  <Input type="number" value={s.lo} onChange={(e) => setSlab(i, { lo: e.target.value })} />
                </div>
                <div className="flex-1 min-w-[120px] space-y-1">
                  <Label className="text-xs">Max {boundLabel} (blank = ∞)</Label>
                  <Input type="number" value={s.hi} onChange={(e) => setSlab(i, { hi: e.target.value })} />
                </div>
                {isFreeGoods ? (
                  <>
                    <div className="flex-1 min-w-[180px] space-y-1">
                      <Label className="text-xs">Free product</Label>
                      <Select value={s.freeProductId ?? ""} items={productItems} onValueChange={(v) => setSlab(i, { freeProductId: v })}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">Free qty</Label>
                      <Input type="number" value={s.freeQty} onChange={(e) => setSlab(i, { freeQty: e.target.value })} />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 min-w-[150px] space-y-1">
                    <Label className="text-xs">
                      {rewardType === "discount_percent" ? "% off" : rewardType === "special_price" ? "Special price ₹" : "₹ off / unit"}
                    </Label>
                    <Input type="number" value={s.rewardValue} onChange={(e) => setSlab(i, { rewardValue: e.target.value })} />
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => setSlabs((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))}
                  disabled={slabs.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 9. Products */}
      <div className="space-y-1.5 border-t border-border pt-5">
        <Label>
          {schemeType === "value_slab" ? "Products counted toward the order value (leave empty = whole order)" : "Products this scheme applies to"}
        </Label>
        <MultiSelect options={productOptions} selectedValues={productIds} onChange={setProductIds} placeholder="Select products…" searchable />
      </div>

      {/* 10. Customer selection */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Who it applies to</Label>
          <Select value={targetType} items={TARGET_LABELS} onValueChange={(v) => setTargetType(v as "all" | "specific_customers")}>
            <SelectTrigger className="w-full sm:max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{TARGET_LABELS.all}</SelectItem>
              <SelectItem value="specific_customers">{TARGET_LABELS.specific_customers}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {targetType === "specific_customers" && (
          <div className="space-y-1.5">
            <Label>Customers</Label>
            <MultiSelect options={customerOptions} selectedValues={customerIds} onChange={setCustomerIds} placeholder="Select customers…" searchable />
          </div>
        )}
      </div>

      {/* 11. Priority */}
      <div className="space-y-1.5 border-t border-border pt-5">
        <Label>Priority (tie-breaker)</Label>
        <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="sm:max-w-xs" />
        <p className="text-xs text-muted-foreground">
          Only matters when <strong>two schemes could apply to the same product at once</strong>. The higher number wins;
          the other is ignored. If your schemes never overlap, leave this at 0.
        </p>
      </div>

      {/* Active (edit only — new schemes start active) */}
      {isEdit && (
        <div className="flex items-center justify-between border-t border-border pt-5">
          <div>
            <Label>Active</Label>
            <p className="text-xs text-muted-foreground">Off = never suggested, even within its dates. Turn back on any time.</p>
          </div>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  const title = isEdit ? "Edit scheme" : cloneFromId ? "Duplicate scheme" : "New scheme";
  const saveLabel = isEdit ? "Save changes" : cloneFromId ? "Create copy" : "Create scheme";

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button onClick={handleSave} disabled={saving || loading}>
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {saveLabel}
      </Button>
    </div>
  );

  if (asPage) {
    return (
      <div className="p-8 w-full max-w-none space-y-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 border border-border hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4 text-foreground" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Tag className="w-6 h-6 text-primary" />
              {title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Promotions are <strong>suggested</strong> to the salesman at order entry — they confirm what applies.
            </p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm max-w-4xl">
          {body}
          <div className="pt-6 mt-6 border-t border-border">{footer}</div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Promotions are suggested to the salesman at order entry — they confirm what applies.
          </DialogDescription>
        </DialogHeader>
        {body}
        <div className="pt-4 border-t border-border">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}

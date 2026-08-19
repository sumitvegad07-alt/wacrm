"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  type SchemeWithDetails,
} from "@/lib/schemes/types";

/** A single slab as the form edits it — bounds are generic (qty OR value). */
interface SlabDraft {
  lo: string; // lower bound (qty or value)
  hi: string; // upper bound, blank = open-ended
  rewardValue: string;
  freeProductId: string | null;
  freeQty: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  editScheme?: SchemeWithDetails;
  products: ProductOption[];
  customers: CustomerOption[];
  busy: boolean;
  onSubmit: (values: SchemeFormValues) => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function emptySlab(): SlabDraft {
  return { lo: "", hi: "", rewardValue: "", freeProductId: null, freeQty: "" };
}

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function SchemeFormDialog({
  open,
  onClose,
  mode,
  editScheme,
  products,
  customers,
  busy,
  onSubmit,
}: Props) {
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

  // Hydrate on open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && editScheme) {
      setName(editScheme.name);
      setSchemeType(editScheme.scheme_type);
      setSlabMode(editScheme.slab_mode);
      setRewardType(
        editScheme.scheme_type === "free_goods"
          ? "free_goods"
          : (editScheme.slabs[0]?.reward_type ?? rewardTypesFor(editScheme.scheme_type)[0]),
      );
      setTargetType(editScheme.target_type);
      setProductIds(editScheme.productIds);
      setCustomerIds(editScheme.customerIds);
      setPriority(String(editScheme.priority));
      setStartsOn(editScheme.starts_on);
      setEndsOn(editScheme.ends_on ?? "");
      setMaxFree(editScheme.max_free_units_per_order != null ? String(editScheme.max_free_units_per_order) : "");
      setActive(editScheme.active);
      const useValue = usesValueBounds(editScheme.scheme_type);
      setSlabs(
        (editScheme.slabs.length ? editScheme.slabs : [null]).map((s): SlabDraft => {
          if (!s) return emptySlab();
          return {
            lo: String((useValue ? s.min_value : s.min_qty) ?? ""),
            hi: (useValue ? s.max_value : s.max_qty) == null ? "" : String(useValue ? s.max_value : s.max_qty),
            rewardValue: s.reward_value == null ? "" : String(s.reward_value),
            freeProductId: s.free_product_id,
            freeQty: s.free_qty == null ? "" : String(s.free_qty),
          };
        }),
      );
    } else {
      setName("");
      setSchemeType("quantity_slab");
      setSlabMode("step_up");
      setRewardType("discount_percent");
      setTargetType("all");
      setProductIds([]);
      setCustomerIds([]);
      setPriority("0");
      setStartsOn(todayISO());
      setEndsOn("");
      setMaxFree("");
      setActive(true);
      setSlabs([emptySlab()]);
    }
  }, [open, mode, editScheme]);

  // Keep reward type valid whenever scheme type changes.
  useEffect(() => {
    const allowed = rewardTypesFor(schemeType);
    setRewardType((rt) => (allowed.includes(rt) ? rt : allowed[0]));
    if (schemeType === "value_slab") setTargetType((t) => t); // value slabs still support targeting
  }, [schemeType]);

  const useValue = usesValueBounds(schemeType);
  const isFreeGoods = rewardType === "free_goods";
  const boundLabel = useValue ? "value" : "qty";

  const productOptions = useMemo(
    () => products.map((p) => ({ label: `${p.name} (₹${p.price})`, value: p.id })),
    [products],
  );
  const customerOptions = useMemo(
    () => customers.map((c) => ({ label: c.label, value: c.id })),
    [customers],
  );

  const setSlab = (i: number, patch: Partial<SlabDraft>) =>
    setSlabs((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  function validateAndBuild(): SchemeFormValues | null {
    if (!name.trim()) return fail("Give the scheme a name.");
    if (!startsOn) return fail("Set a start date.");
    if (endsOn && endsOn < startsOn) return fail("End date can't be before the start date.");
    if (slabs.length === 0) return fail("Add at least one slab.");

    const builtSlabs: SchemeSlabRow[] = [];
    for (let i = 0; i < slabs.length; i++) {
      const s = slabs[i];
      const lo = toNum(s.lo);
      const hi = toNum(s.hi);
      if (lo === null || lo < 0) return fail(`Slab ${i + 1}: enter a valid lower ${boundLabel}.`);
      if (hi !== null && hi < lo) return fail(`Slab ${i + 1}: upper ${boundLabel} is below the lower.`);

      let reward_value: number | null = null;
      let free_product_id: string | null = null;
      let free_qty: number | null = null;

      if (isFreeGoods) {
        if (!s.freeProductId) return fail(`Slab ${i + 1}: choose the free product.`);
        const fq = toNum(s.freeQty);
        if (fq === null || fq <= 0) return fail(`Slab ${i + 1}: enter a free quantity above 0.`);
        free_product_id = s.freeProductId;
        free_qty = fq;
      } else {
        const rv = toNum(s.rewardValue);
        if (rv === null || rv <= 0) return fail(`Slab ${i + 1}: enter a reward value above 0.`);
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

    const prio = toNum(priority);
    const cap = isFreeGoods ? toNum(maxFree) : null;

    return {
      name: name.trim(),
      schemeType,
      slabMode: useValue ? "step_up" : slabMode,
      targetType,
      maxFreeUnitsPerOrder: cap,
      priority: prio ?? 0,
      startsOn,
      endsOn: endsOn || null,
      active,
      productIds: schemeType === "value_slab" ? productIds : productIds,
      customerIds: targetType === "specific_customers" ? customerIds : [],
      slabs: builtSlabs,
    };
  }

  function fail(msg: string): null {
    setError(msg);
    return null;
  }

  function handleSubmit() {
    const values = validateAndBuild();
    if (values) onSubmit(values);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit scheme" : "New scheme"}</DialogTitle>
          <DialogDescription>
            Promotions are <strong>suggested</strong> to the salesman at order entry — they confirm
            what applies. Nothing here changes an order on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali — Buy 10 get 1" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={schemeType} onValueChange={(v) => setSchemeType(v as SchemeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCHEME_TYPE_LABELS) as SchemeType[]).map((t) => (
                    <SelectItem key={t} value={t}>{SCHEME_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Reward</Label>
              <Select
                value={rewardType}
                onValueChange={(v) => setRewardType(v as SchemeRewardType)}
                disabled={schemeType === "free_goods"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rewardTypesFor(schemeType).map((rt) => (
                    <SelectItem key={rt} value={rt}>{REWARD_TYPE_LABELS[rt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!useValue && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Slab mode</Label>
                <Select value={slabMode} onValueChange={(v) => setSlabMode(v as "step_up" | "repeat")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="step_up">Step up — highest slab reached</SelectItem>
                    <SelectItem value="repeat">Repeat — every complete set</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isFreeGoods && (
                <div className="space-y-1.5">
                  <Label>Max free units / order</Label>
                  <Input
                    type="number"
                    value={maxFree}
                    onChange={(e) => setMaxFree(e.target.value)}
                    placeholder="Leave blank = uncapped"
                  />
                </div>
              )}
            </div>
          )}

          {/* Products */}
          <div className="space-y-1.5">
            <Label>
              {schemeType === "value_slab"
                ? "Products counted toward the basket (leave empty = whole order)"
                : "Products this scheme applies to"}
            </Label>
            <MultiSelect
              options={productOptions}
              selectedValues={productIds}
              onChange={setProductIds}
              placeholder="Select products…"
            />
          </div>

          {/* Targeting */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Who it applies to</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as "all" | "specific_customers")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All customers</SelectItem>
                  <SelectItem value="specific_customers">Specific customers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
              <p className="text-xs text-muted-foreground">Higher wins when two schemes match a line.</p>
            </div>
          </div>

          {targetType === "specific_customers" && (
            <div className="space-y-1.5">
              <Label>Customers</Label>
              <MultiSelect
                options={customerOptions}
                selectedValues={customerIds}
                onChange={setCustomerIds}
                placeholder="Select customers…"
              />
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Starts on</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Ends on (optional)</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>

          {/* Slabs */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <Label>Slabs</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setSlabs((p) => [...p, emptySlab()])}>
                <Plus className="h-4 w-4 mr-1" /> Add slab
              </Button>
            </div>
            <div className="space-y-2">
              {slabs.map((s, i) => (
                <div key={i} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Min {boundLabel}</Label>
                      <Input type="number" value={s.lo} onChange={(e) => setSlab(i, { lo: e.target.value })} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Max {boundLabel} (blank = ∞)</Label>
                      <Input type="number" value={s.hi} onChange={(e) => setSlab(i, { hi: e.target.value })} />
                    </div>
                    {isFreeGoods ? (
                      <>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Free product</Label>
                          <Select
                            value={s.freeProductId ?? ""}
                            onValueChange={(v) => setSlab(i, { freeProductId: v })}
                          >
                            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-24 space-y-1">
                          <Label className="text-xs">Free qty</Label>
                          <Input type="number" value={s.freeQty} onChange={(e) => setSlab(i, { freeQty: e.target.value })} />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">
                          {rewardType === "discount_percent" ? "% off" : rewardType === "special_price" ? "Special price" : "₹ off / unit"}
                        </Label>
                        <Input type="number" value={s.rewardValue} onChange={(e) => setSlab(i, { rewardValue: e.target.value })} />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5 text-destructive"
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

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Off = never suggested, even inside its dates.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "edit" ? "Save changes" : "Create scheme"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

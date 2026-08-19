"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Pencil, Copy, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Timeline } from "@/components/shared/timeline";
import { StatusBadge } from "@/components/shared";
import { getCustomerOptions, getProductOptions, getScheme } from "@/lib/schemes/api";
import {
  REWARD_TYPE_LABELS,
  SCHEME_TYPE_LABELS,
  schemeStatus,
  usesValueBounds,
  type CustomerOption,
  type ProductOption,
  type SchemeSlabRow,
  type SchemeStatus,
  type SchemeWithDetails,
} from "@/lib/schemes/types";

const todayISO = () => new Date().toISOString().slice(0, 10);
const STATUS_LABEL: Record<SchemeStatus, string> = { live: "Live", scheduled: "Scheduled", expired: "Expired", inactive: "Inactive" };

function bandsText(scheme: SchemeWithDetails): string {
  const useValue = usesValueBounds(scheme.scheme_type);
  return scheme.slabs
    .map((s: SchemeSlabRow) => {
      const lo = useValue ? s.min_value : s.min_qty;
      const hi = useValue ? s.max_value : s.max_qty;
      const band = hi == null ? `${useValue ? "₹" : ""}${lo ?? 0}+` : `${useValue ? "₹" : ""}${lo ?? 0}–${useValue ? "₹" : ""}${hi}`;
      const reward =
        s.reward_type === "free_goods" ? `${s.free_qty ?? 0} free`
          : s.reward_type === "discount_percent" ? `${s.reward_value ?? 0}% off`
          : s.reward_type === "discount_amount" ? `₹${s.reward_value ?? 0}/unit off`
          : `special ₹${s.reward_value ?? 0}`;
      return `${band} → ${reward}`;
    })
    .join(",  ") || "—";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="font-medium break-words">{value}</p>
    </div>
  );
}

export default function SchemeDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { account } = useAuth();
  const accountId = account?.id ?? null;

  const [scheme, setScheme] = useState<SchemeWithDetails | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [s, p, c] = await Promise.all([getScheme(accountId, id), getProductOptions(accountId), getCustomerOptions(accountId)]);
      if (!s) {
        toast.error("Scheme not found.");
        router.push("/schemes");
        return;
      }
      setScheme(s);
      setProducts(p);
      setCustomers(c);

      const [tasksRes, actRes] = await Promise.all([
        supabase.from("tasks").select("*").eq("scheme_id", id).order("created_at", { ascending: false }),
        supabase.from("module_activities").select("*").eq("module_name", "scheme").eq("record_id", id).order("created_at", { ascending: false }),
      ]);
      setTasks(tasksRes.data ?? []);

      const acts = actRes.data ?? [];
      const userIds = Array.from(new Set(acts.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds);
        const map = (profiles ?? []).reduce((acc: any, pr: any) => { acc[pr.user_id] = pr; return acc; }, {});
        setActivities(acts.map((a: any) => ({ ...a, user: map[a.user_id] || null })));
      } else {
        setActivities(acts);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load scheme.");
    } finally {
      setLoading(false);
    }
  }, [accountId, id, supabase, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const productName = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]));
    return (pid: string) => m.get(pid) ?? "product";
  }, [products]);
  const customerLabel = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.label]));
    return (cid: string) => m.get(cid) ?? "customer";
  }, [customers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!scheme) return null;

  const status = schemeStatus(scheme, todayISO());
  const rewardType = scheme.scheme_type === "free_goods" ? "free_goods" : scheme.slabs[0]?.reward_type;

  return (
    <div className="space-y-6 w-full max-w-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/schemes")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
              <Tag className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{scheme.name}</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
                {SCHEME_TYPE_LABELS[scheme.scheme_type]}
                <StatusBadge status={status === "live" ? "active" : status} label={STATUS_LABEL[status]} />
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push(`/schemes/new?from=${scheme.id}`)} className="gap-2">
            <Copy className="size-4" /> Duplicate
          </Button>
          <Button onClick={() => router.push(`/schemes/${scheme.id}/edit`)} className="gap-2">
            <Pencil className="size-4" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Scheme Details</h3>
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <Field label="Type" value={SCHEME_TYPE_LABELS[scheme.scheme_type]} />
              <Field label="Reward" value={rewardType ? REWARD_TYPE_LABELS[rewardType] : "—"} />
              {!usesValueBounds(scheme.scheme_type) && (
                <Field label="How bands apply" value={scheme.slab_mode === "repeat" ? "Repeats per set" : "Best band reached (tiered)"} />
              )}
              {scheme.scheme_type === "free_goods" && (
                <Field label="Max free units / order" value={scheme.max_free_units_per_order ?? "No cap"} />
              )}
              <Field label="Window" value={`${scheme.starts_on}${scheme.ends_on ? ` → ${scheme.ends_on}` : " → open"}`} />
              <Field label="Priority" value={scheme.priority} />
              <Field label="Status" value={STATUS_LABEL[status]} />
              <div className="col-span-2">
                <Field label={usesValueBounds(scheme.scheme_type) ? "Order-value bands" : "Quantity bands"} value={bandsText(scheme)} />
              </div>
              <div className="col-span-2">
                <Field
                  label={scheme.scheme_type === "value_slab" ? "Products counted toward order value" : "Products this scheme applies to"}
                  value={
                    scheme.productIds.length === 0
                      ? (scheme.scheme_type === "value_slab" ? "Whole order" : "—")
                      : scheme.productIds.map(productName).join(", ")
                  }
                />
              </div>
              <div className="col-span-2">
                <Field
                  label="Applies to"
                  value={
                    scheme.target_type === "all"
                      ? "All customers"
                      : scheme.customerIds.length
                        ? scheme.customerIds.map(customerLabel).join(", ")
                        : "Specific customers (none selected)"
                  }
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: timeline (tasks + logs) */}
        <div className="w-full">
          <Timeline moduleName="scheme" recordId={scheme.id} tasks={tasks} activities={activities} onRefresh={fetchAll} />
        </div>
      </div>
    </div>
  );
}

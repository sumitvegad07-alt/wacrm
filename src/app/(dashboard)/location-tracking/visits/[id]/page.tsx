"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { haversineKm } from "@/lib/location/distance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  MapPin,
  ShoppingCart,
  Receipt,
  Clock,
  User as UserIcon,
  Loader2,
} from "lucide-react";

/**
 * Detailed view of a single field visit (site_visits row). The list at
 * ../page.tsx links each row here. Mirrors the mobile visit detail: who was
 * visited, where, check-in/out and duration, the distance between where the rep
 * stood and the customer's registered location, the transactions raised during
 * the visit (orders + payments, joined on site_visit_id), feedback, and a
 * chronological Visit Log of everything generated on the visit.
 */

interface VisitOrder {
  id: string;
  order_number: string | null;
  total_amount: number | null;
  status: string | null;
  created_at: string;
  user_id: string | null;
}
interface VisitPayment {
  id: string;
  payment_number: string | null;
  amount: number | null;
  status: string | null;
  created_at: string;
  user_id: string | null;
}

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [visit, setVisit] = useState<any>(null);
  const [target, setTarget] = useState<any>(null); // customer or lead
  const [isLead, setIsLead] = useState(false);
  const [orders, setOrders] = useState<VisitOrder[]>([]);
  const [payments, setPayments] = useState<VisitPayment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: v } = await supabase
        .from("site_visits")
        .select("*, profiles ( full_name )")
        .eq("id", id)
        .maybeSingle();

      if (!v) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setVisit(v);

      // Account currency for money formatting.
      const { data: acct } = await supabase
        .from("accounts")
        .select("default_currency")
        .eq("id", v.account_id)
        .maybeSingle();
      setCurrency(acct?.default_currency || undefined);

      // Resolve the visited party. Visits are polymorphic: a Lead target is in
      // leads; otherwise the customer is in contacts (contact_id or target_id).
      const lead = v.target_type === "Lead";
      setIsLead(lead);
      if (lead && v.target_id) {
        const { data: l } = await supabase.from("leads").select("*").eq("id", v.target_id).maybeSingle();
        setTarget(l);
      } else {
        const contactId = v.contact_id || v.target_id;
        if (contactId) {
          const { data: c } = await supabase.from("contacts").select("*").eq("id", contactId).maybeSingle();
          setTarget(c);
        }
      }

      // Transactions raised on this visit, joined by site_visit_id.
      const [{ data: ords }, { data: pays }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_number, total_amount, status, created_at, user_id")
          .eq("site_visit_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("payments")
          .select("id, payment_number, amount, status, created_at, user_id")
          .eq("site_visit_id", id)
          .order("created_at", { ascending: true }),
      ]);
      setOrders(ords || []);
      setPayments(pays || []);

      // Names for the Visit Log "by <person>" lines.
      const userIds = [
        ...new Set([
          v.user_id,
          ...(ords || []).map((o: any) => o.user_id),
          ...(pays || []).map((p: any) => p.user_id),
        ].filter(Boolean)),
      ] as string[];
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", userIds);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => { map[p.user_id] = p.full_name; });
        setNames(map);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const money = (v: any) => formatCurrency(Number(v || 0), currency);

  const durationMin = useMemo(() => {
    if (!visit?.check_in_at || !visit?.check_out_at) return null;
    return Math.round(
      (new Date(visit.check_out_at).getTime() - new Date(visit.check_in_at).getTime()) / 60000
    );
  }, [visit]);

  // Distance between where the rep checked in and the customer's registered
  // (geo-tagged) location — the same "Distance Difference" the mobile visit shows.
  const distanceMeters = useMemo(() => {
    if (!visit || !target) return null;
    const cLat = visit.check_in_lat, cLng = visit.check_in_lng;
    const tLat = target.latitude, tLng = target.longitude;
    if (cLat == null || cLng == null || tLat == null || tLng == null) return null;
    return Math.round(haversineKm(cLat, cLng, tLat, tLng) * 1000 * 100) / 100;
  }, [visit, target]);

  const orderTotal = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const paymentTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  // Merged chronological Visit Log.
  const logEntries = useMemo(() => {
    const entries: { kind: "order" | "payment"; label: string; by: string; at: string; href?: string }[] = [];
    for (const o of orders) {
      entries.push({
        kind: "order",
        label: `ORDER ${o.order_number || o.id.slice(0, 6)} generated.`,
        by: (o.user_id && names[o.user_id]) || "—",
        at: o.created_at,
        href: `/orders/${o.id}`,
      });
    }
    for (const p of payments) {
      entries.push({
        kind: "payment",
        label: `PAYMENT COLLECTION ${p.payment_number || p.id.slice(0, 6)} generated.`,
        by: (p.user_id && names[p.user_id]) || "—",
        at: p.created_at,
      });
    }
    return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [orders, payments, names]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (notFound || !visit) {
    return (
      <div className="p-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 mb-4">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <p className="text-muted-foreground">Visit not found.</p>
      </div>
    );
  }

  const targetName = target?.name || "Unknown";
  const targetCode = target?.customer_id ? `[${target.customer_id}] ` : "";
  const targetHref = isLead ? `/leads/${target?.id}` : `/contacts/${target?.id}`;
  const addressParts = [target?.address, target?.area, target?.city, target?.state, target?.pincode, target?.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="size-4" /> Back
          </Button>
          <h1 className="text-xl font-semibold text-foreground">Customer Visit</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <p className="text-sm italic text-muted-foreground">Visited To,</p>
            <Link href={targetHref} className="text-lg font-semibold text-primary hover:underline">
              {targetCode}{targetName}
            </Link>
            {target?.area && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" /> {target.area}
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Visit Address</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{addressParts || "—"}</p>
                {distanceMeters != null && (
                  <p className="mt-1 text-sm text-foreground">
                    <span className="text-muted-foreground">Distance Difference: </span>
                    <span className="font-semibold">{distanceMeters} meters</span>
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Visited By</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{visit.profiles?.full_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Duration</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{durationMin != null ? `${durationMin} min` : "Active"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Check-in Time</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{fmtDateTime(visit.check_in_at)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Check-out Time</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{visit.check_out_at ? fmtDateTime(visit.check_out_at) : "Active"}</p>
              </div>
            </div>
          </Card>

          {/* Transactions */}
          {(orders.length > 0 || payments.length > 0) && (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Transactions</h2>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-foreground">Module</th>
                      <th className="px-4 py-2 text-left font-semibold text-foreground">Total amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length > 0 && (
                      <tr className="border-t border-border">
                        <td className="px-4 py-2 text-foreground">Order</td>
                        <td className="px-4 py-2 text-foreground">{money(orderTotal)}</td>
                      </tr>
                    )}
                    {payments.length > 0 && (
                      <tr className="border-t border-border">
                        <td className="px-4 py-2 text-foreground">Payment collection</td>
                        <td className="px-4 py-2 text-foreground">{money(paymentTotal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Feedback */}
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Feedback Details</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Feedback Type</p>
                {visit.feedback_type ? (
                  <Badge className="mt-1 border-transparent bg-emerald-600 font-medium text-white shadow-sm">
                    {visit.feedback_type}
                  </Badge>
                ) : (
                  <p className="mt-0.5 text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Feedback Description</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{visit.feedback_text || "—"}</p>
              </div>
            </div>
          </Card>

          {/* Other details: notes + shop photo */}
          {(visit.notes || visit.visit_photo_url) && (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Other Details</h2>
              {visit.notes && (
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{visit.notes}</p>
                </div>
              )}
              {visit.visit_photo_url && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Shop Photo</p>
                  <a href={visit.visit_photo_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={visit.visit_photo_url}
                      alt="Shop"
                      className="max-h-64 rounded-md border border-border object-contain"
                    />
                  </a>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Visit Log sidebar */}
        <div className="lg:col-span-1">
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Visit Log</h2>
            {logEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions were generated on this visit.</p>
            ) : (
              <ol className="space-y-4">
                {logEntries.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      {e.kind === "order" ? (
                        <ShoppingCart className="size-4 text-muted-foreground" />
                      ) : (
                        <Receipt className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      {e.href ? (
                        <Link href={e.href} className="text-sm font-medium text-foreground hover:text-primary hover:underline">
                          {e.label}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-foreground">{e.label}</p>
                      )}
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <UserIcon className="size-3" /> by {e.by}
                        <Clock className="ml-1 size-3" /> {fmtDateTime(e.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { monthlyRevenue } from "@/lib/admin/billing";
import {
  CreditCard,
  Building2,
  TrendingUp,
  Users,
} from "lucide-react";

interface PlanTier {
  name: string;
  price: number; // monthly INR, 0 = free
  features: string[];
  color: string;
  bgColor: string;
}

const PLANS: PlanTier[] = [
  {
    name: "Basic",
    price: 100,
    features: [
      "Min 3 Users",
      "Core CRM (Contacts, Pipelines, Tasks)",
      "Quotations & Products",
      "Custom Fields & Tags",
    ],
    color: "text-slate-700 dark:text-slate-300",
    bgColor: "bg-muted/50 border-border",
  },
  {
    name: "Pro",
    price: 200,
    features: [
      "Min 3 Users",
      "WhatsApp Integration (Shared Inbox)",
      "Message & Industry Templates",
      "Basic Automations",
      "Broadcasts",
    ],
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/20",
  },
  {
    name: "Enterprise",
    price: 350,
    features: [
      "Min 3 Users",
      "Full AI Assistant",
      "AI Knowledge Base",
      "Advanced Flows (Builder)",
      "VIP Support",
    ],
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-500/10 border-violet-500/20",
  },
];

interface AccountBilling {
  id: string;
  name: string;
  subscription_plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  deleted_at: string | null;
  created_at: string;
  user_count: number;
  addons: string[];
}

export default function BillingPage() {
  const [accounts, setAccounts] = useState<AccountBilling[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'yearly' | 'half-yearly' | 'quarterly'>('yearly');
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("accounts")
        .select(
          "id, name, subscription_plan, subscription_status, subscription_expires_at, created_at, user_count, addons, deleted_at"
        )
        .order("subscription_plan");
      setAccounts(data || []);
      setLoading(false);
    }
    load();
  }, []);

  // Soft-deleted tenants are excluded from every commercial metric: they are
  // not customers, and counting them inflates MRR and the active-tenant count
  // with revenue that has already been cancelled. They stay visible in the
  // Recovery Center and are reported separately below.
  const liveAccounts = accounts.filter((a) => !a.deleted_at);
  const deletedCount = accounts.length - liveAccounts.length;

  const byPlan = (plan: string) =>
    liveAccounts.filter((a) => a.subscription_plan === plan);

  const calculateMRR = () => {
    let mrr = 0;
    liveAccounts.forEach(a => {
      const seats = Math.max(a.user_count || 3, 3);
      // New line-based plans (CRM / WFA / CRM+WFA / SFA / CRM+SFA) are priced by
      // the shared catalog; monthlyRevenue returns 0 for legacy plans, which the
      // fallbacks below still count so revenue is not lost during the migration.
      mrr += monthlyRevenue(a.subscription_plan, a.user_count);
      if (a.subscription_plan === 'Basic') mrr += 100 * seats;
      if (a.subscription_plan === 'Pro') mrr += 200 * seats;
      if (a.subscription_plan === 'Enterprise') mrr += 350 * seats;
      if (a.addons?.includes('field_tracking')) mrr += 200 * seats;
    });
    return mrr;
  };

  const mrrEstimate = calculateMRR();

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active:
        "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
      trialing:
        "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400",
      expired:
        "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
      deactivated:
        "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    };
    return (
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
          map[status] || map["expired"]
        }`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing & Plans</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Revenue overview. To assign or change a tenant&apos;s plan (CRM / WFA /
          SFA) and modules, use <strong>Set plan</strong> on any row below.
        </p>
      </div>

      {/* Tenant counts, split so the commercial numbers are unambiguous */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span>
          <strong className="tabular-nums">{liveAccounts.length}</strong>{" "}
          <span className="text-muted-foreground">active tenants</span>
        </span>
        {deletedCount > 0 && (
          <span>
            <strong className="tabular-nums text-amber-600">{deletedCount}</strong>{" "}
            <span className="text-muted-foreground">
              deleted (recoverable, excluded from MRR)
            </span>
          </span>
        )}
      </div>

      {/* MRR Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <p className="text-sm text-muted-foreground">Est. MRR</p>
          </div>
          <p className="text-2xl font-bold text-foreground">
            ₹{mrrEstimate.toLocaleString("en-IN")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Based on current plan prices
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="h-5 w-5 text-blue-500" />
            <p className="text-sm text-muted-foreground">Paid Accounts</p>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {byPlan("Pro").length + byPlan("Enterprise").length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Pro + Enterprise
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Basic Accounts</p>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {byPlan("Basic").length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Conversion targets
          </p>
        </div>
      </div>

      {/* Plan Cards */}
      <div>
        <div className="flex flex-col items-center justify-center mb-8 mt-4">
          <h2 className="text-lg font-bold mb-4 text-foreground">Select Billing Cycle</h2>
          <div className="inline-flex items-center bg-muted/30 p-1.5 rounded-full border border-border shadow-sm">
            <button
              onClick={() => setBillingCycle('quarterly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 ${billingCycle === 'quarterly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              Quarterly
            </button>
            <button
              onClick={() => setBillingCycle('half-yearly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 ${billingCycle === 'half-yearly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              Half-Yearly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 ${billingCycle === 'yearly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              Yearly
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`border border-border rounded-xl p-5 ${plan.bgColor}`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-lg font-bold ${plan.color}`}>
                  {plan.name}
                </h3>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">
                    {byPlan(plan.name).length}
                  </span>
                </div>
              </div>
              <p className="text-xl font-bold text-foreground mb-3">
                {plan.price === 0
                  ? "Free"
                  : `₹${(billingCycle === 'quarterly' 
                          ? Math.round(plan.price * 1.3) 
                          : billingCycle === 'half-yearly' 
                            ? Math.round(plan.price * 1.2) 
                            : plan.price
                        ).toLocaleString("en-IN")}/user/mo`}
              </p>
              <ul className="space-y-1">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                  >
                    <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* All Accounts Table */}
      <div>
        <h2 className="text-base font-semibold mb-4">All Accounts</h2>
        {loading ? (
          <div className="bg-muted rounded-xl h-40 animate-pulse" />
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium text-foreground">Company</th>
                  <th className="px-4 py-3 font-medium text-foreground">Plan</th>
                  <th className="px-4 py-3 font-medium text-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-foreground">Expires</th>
                  <th className="px-4 py-3 font-medium text-foreground">Joined</th>
                  <th className="px-4 py-3 font-medium text-foreground text-right">Plan &amp; Billing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accounts.map((a) => (
                  <tr
                    key={a.id}
                    className={`hover:bg-muted/50 ${a.deleted_at ? "opacity-60" : ""}`}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {a.name}
                      {a.deleted_at && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                          Deleted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.subscription_plan}
                    </td>
                    <td className="px-4 py-3">
                      {statusBadge(a.subscription_status)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {a.subscription_expires_at
                        ? new Date(a.subscription_expires_at).toLocaleDateString(
                            "en-IN"
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(a.created_at).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/companies/${a.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                      >
                        Set plan
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

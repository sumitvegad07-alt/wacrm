"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Building2,
  Users,
  ShieldOff,
  TrendingUp,
  Clock,
  CheckCircle2,
} from "lucide-react";

interface Stats {
  totalCompanies: number;
  totalUsers: number;
  activeAccounts: number;
  deactivatedAccounts: number;
  trialingAccounts: number;
  planBreakdown: Record<string, number>;
  recentSignups: { id: string; name: string; created_at: string; subscription_plan: string }[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-primary",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4">
      <div className={`p-2 rounded-lg bg-muted ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadStats() {
      const [accountsRes, usersRes] = await Promise.all([
        supabase
          .from("accounts")
          .select("id, name, created_at, subscription_status, subscription_plan"),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
      ]);

      const accounts = accountsRes.data || [];
      const totalUsers = usersRes.count ?? 0;

      const planBreakdown: Record<string, number> = {};
      let activeAccounts = 0;
      let deactivatedAccounts = 0;
      let trialingAccounts = 0;

      accounts.forEach((a) => {
        planBreakdown[a.subscription_plan] =
          (planBreakdown[a.subscription_plan] || 0) + 1;
        if (a.subscription_status === "active") activeAccounts++;
        if (a.subscription_status === "deactivated") deactivatedAccounts++;
        if (a.subscription_status === "trialing") trialingAccounts++;
      });

      const recentSignups = [...accounts]
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 5);

      setStats({
        totalCompanies: accounts.length,
        totalUsers,
        activeAccounts,
        deactivatedAccounts,
        trialingAccounts,
        planBreakdown,
        recentSignups,
      });
      setLoading(false);
    }
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-muted rounded-xl h-24" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const paidCount =
    (stats.planBreakdown["Pro"] || 0) +
    (stats.planBreakdown["Enterprise"] || 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform-wide overview — all tenants, all users.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="Total Companies"
          value={stats.totalCompanies}
          color="text-blue-500"
        />
        <StatCard
          icon={Users}
          label="Total Users"
          value={stats.totalUsers}
          sub="across all tenants"
          color="text-violet-500"
        />
        <StatCard
          icon={CheckCircle2}
          label="Active Accounts"
          value={stats.activeAccounts}
          color="text-green-500"
        />
        <StatCard
          icon={TrendingUp}
          label="Paid Accounts"
          value={paidCount}
          sub={`${stats.planBreakdown["Free"] || 0} on Free`}
          color="text-amber-500"
        />
        {stats.trialingAccounts > 0 && (
          <StatCard
            icon={Clock}
            label="On Trial"
            value={stats.trialingAccounts}
            color="text-cyan-500"
          />
        )}
        {stats.deactivatedAccounts > 0 && (
          <StatCard
            icon={ShieldOff}
            label="Deactivated"
            value={stats.deactivatedAccounts}
            color="text-red-500"
          />
        )}
      </div>

      {/* Plan Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-base font-semibold mb-4">Plan Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(stats.planBreakdown).map(([plan, count]) => {
              const pct = Math.round((count / stats.totalCompanies) * 100);
              const barColor =
                plan === "Enterprise"
                  ? "bg-violet-500"
                  : plan === "Pro"
                  ? "bg-blue-500"
                  : "bg-muted-foreground/40";
              return (
                <div key={plan}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground font-medium">{plan}</span>
                    <span className="text-muted-foreground">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Signups */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-base font-semibold mb-4">Recent Signups</h2>
          <div className="space-y-3">
            {stats.recentSignups.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  {c.subscription_plan}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

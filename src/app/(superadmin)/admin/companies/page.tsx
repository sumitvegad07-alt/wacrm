"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompanyRow {
  id: string;
  customer_id: string | null;
  name: string;
  industry: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  owner_name: string | null;
  owner_email: string | null;
  user_count: number;
}

export default function CompaniesListPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCompanies() {
      // Goes through the service-role superadmin route so counts and owner are
      // correct across every tenant, and soft-deleted accounts are excluded.
      // One account == one Customer ID; team members show as the user count,
      // not as their own rows.
      const res = await fetch("/api/admin/companies");
      const payload = await res.json().catch(() => ({}));
      if (res.ok) setCompanies(payload.companies || []);
      setLoading(false);
    }
    loadCompanies();
  }, []);

  if (loading) {
    return <p className="text-muted-foreground">Loading companies...</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Registered Companies</h1>
        <span className="text-sm text-muted-foreground">
          {companies.length} accounts
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium text-foreground">Customer ID</th>
              <th className="px-4 py-3 font-medium text-foreground">Company Name</th>
              <th className="px-4 py-3 font-medium text-foreground">Owner</th>
              <th className="px-4 py-3 font-medium text-foreground">Industry</th>
              <th className="px-4 py-3 font-medium text-foreground">Plan</th>
              <th className="px-4 py-3 font-medium text-foreground">Users</th>
              <th className="px-4 py-3 font-medium text-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {companies.map((c) => (
              <tr key={c.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{c.customer_id || "-"}</td>
                <td className="px-4 py-3 text-foreground font-medium">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.owner_name || "Unknown"} <br />
                  <span className="text-xs">{c.owner_email}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.industry || "-"}</td>
                <td className="px-4 py-3 text-foreground">{c.subscription_plan}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {c.user_count}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold text-white shadow-sm ${c.subscription_status === 'active' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                    {c.subscription_status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/companies/${c.id}`}>
                    <Button variant="outline" size="sm">Manage</Button>
                  </Link>
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No companies found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function CompaniesListPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadCompanies() {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, industry, subscription_status, subscription_plan, created_at, profiles(full_name, email)")
        .order("created_at", { ascending: false });
        
      if (!error) {
        setCompanies(data || []);
      }
      setLoading(false);
    }
    loadCompanies();
  }, []);

  if (loading) {
    return <p className="text-muted-foreground">Loading companies...</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Registered Companies</h1>
      
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium text-foreground">Company Name</th>
              <th className="px-4 py-3 font-medium text-foreground">Owner</th>
              <th className="px-4 py-3 font-medium text-foreground">Industry</th>
              <th className="px-4 py-3 font-medium text-foreground">Plan</th>
              <th className="px-4 py-3 font-medium text-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {companies.map((c) => (
              <tr key={c.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-foreground font-medium">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.profiles?.[0]?.full_name || "Unknown"} <br />
                  <span className="text-xs">{c.profiles?.[0]?.email}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.industry || "-"}</td>
                <td className="px-4 py-3 text-foreground">{c.subscription_plan}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${c.subscription_status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
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
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
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

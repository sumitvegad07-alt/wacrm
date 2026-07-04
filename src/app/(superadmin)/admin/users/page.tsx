"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Search, UserCircle2, ExternalLink } from "lucide-react";
import Link from "next/link";

interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
  account_role: string | null;
  is_superadmin: boolean;
  account_id: string | null;
  account_name: string | null;
}

export default function GlobalUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filtered, setFiltered] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, account_role, is_superadmin, account_id, accounts(name)"
        )
        .order("email");

      const rows: UserRow[] = (data || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        account_role: p.account_role,
        is_superadmin: p.is_superadmin,
        account_id: p.account_id,
        account_name: p.accounts?.name ?? null,
      }));

      setUsers(rows);
      setFiltered(rows);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      q
        ? users.filter(
            (u) =>
              u.email.toLowerCase().includes(q) ||
              (u.full_name || "").toLowerCase().includes(q) ||
              (u.account_name || "").toLowerCase().includes(q)
          )
        : users
    );
  }, [search, users]);

  const roleBadge = (role: string | null, isSuperadmin: boolean) => {
    if (isSuperadmin)
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400">
          Superadmin
        </span>
      );
    const colors: Record<string, string> = {
      owner:
        "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
      admin:
        "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
      agent:
        "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
      viewer:
        "bg-muted text-muted-foreground",
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          colors[role || "viewer"] || colors["viewer"]
        }`}
      >
        {role || "—"}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">All Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every user across all tenant accounts.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {users.length} users
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, email or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-lg outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-muted rounded-lg h-12 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 font-medium text-foreground">User</th>
                <th className="px-4 py-3 font-medium text-foreground">Company</th>
                <th className="px-4 py-3 font-medium text-foreground">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserCircle2 className="h-7 w-7 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">
                          {u.full_name || "(no name)"}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.account_id ? (
                      <Link
                        href={`/admin/companies/${u.account_id}`}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {u.account_name || "Unknown"}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {roleBadge(u.account_role, u.is_superadmin)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

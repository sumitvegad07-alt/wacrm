"use client";

import { useEffect, useState } from "react";
import { Search, UserCircle2, ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

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
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // Goes through the service-role route: `profiles_select` is
      // account-scoped, so querying from the browser only ever returned the
      // superadmin's own company.
      const res = await fetch("/api/admin/users");
      const payload = await res.json();
      const data = res.ok ? payload.users : [];

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

  const toggleSuperadmin = async (userId: string, currentStatus: boolean) => {
    setUpdatingId(userId);
    const nextStatus = !currentStatus;
    // `is_superadmin` is not writable by `authenticated` any more, so this
    // has to go through the guarded service-role route.
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, is_superadmin: nextStatus }),
    });
    const payload = await res.json().catch(() => ({}));
    const error = res.ok && !payload.error ? null : { message: payload.error || "Request failed" };

    if (!error) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_superadmin: nextStatus } : u))
      );
    } else {
      alert("Failed to update superadmin status: " + error.message);
    }
    setUpdatingId(null);
  };

  const roleBadge = (role: string | null, isSuperadmin: boolean) => {
    if (isSuperadmin)
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-600 text-white shadow-sm">
          Platform Superadmin
        </span>
      );
    const colors: Record<string, string> = {
      owner:
        "bg-blue-600 text-white shadow-sm",
      admin:
        "bg-amber-600 text-white shadow-sm",
      agent:
        "bg-slate-600 text-white shadow-sm",
      viewer:
        "bg-muted text-muted-foreground border border-border",
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
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
            Every user across all tenant accounts. Manage platform superadmin privileges below.
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
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 font-medium text-foreground">User</th>
                <th className="px-4 py-3 font-medium text-foreground">Company</th>
                <th className="px-4 py-3 font-medium text-foreground">Role</th>
                <th className="px-4 py-3 font-medium text-foreground text-right">Superadmin Control</th>
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
                        className="flex items-center gap-1 hover:text-foreground transition-colors font-medium text-primary"
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
                  <td className="px-4 py-3 text-right">
                    {u.is_superadmin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === u.id}
                        onClick={() => toggleSuperadmin(u.id, true)}
                        className="gap-1.5 text-xs border-red-500/40 text-red-600 hover:bg-red-500/10"
                      >
                        <ShieldAlert className="size-3.5" />
                        Revoke Superadmin
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={updatingId === u.id}
                        onClick={() => toggleSuperadmin(u.id, false)}
                        className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                      >
                        <ShieldCheck className="size-3.5" />
                        Grant Superadmin
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
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

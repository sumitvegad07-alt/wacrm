"use client";

import { useEffect, useState } from "react";
import { Search, ShieldCheck, ShieldAlert, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isFounderEmail } from "@/lib/auth/founder";

interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
  is_superadmin: boolean;
  account_name: string | null;
}

export default function AccessControlClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/users");
      const payload = await res.json().catch(() => ({}));
      const data = res.ok ? payload.users : [];
      setUsers(
        (data || []).map((p: any) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          is_superadmin: p.is_superadmin,
          account_name: p.accounts?.name ?? null,
        })),
      );
      setLoading(false);
    })();
  }, []);

  const toggleSuperadmin = async (u: UserRow) => {
    const nextStatus = !u.is_superadmin;
    const verb = nextStatus ? "GRANT superadmin to" : "REVOKE superadmin from";
    if (
      !window.confirm(
        `Are you sure you want to ${verb} ${u.email}?\n\nThis is a platform-wide privilege change.`,
      )
    )
      return;

    setUpdatingId(u.id);
    setErr(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, is_superadmin: nextStatus }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && !payload.error) {
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, is_superadmin: nextStatus } : x)),
      );
    } else {
      setErr(payload.error || "Request failed");
    }
    setUpdatingId(null);
  };

  const q = search.toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.full_name || "").toLowerCase().includes(q) ||
          (u.account_name || "").toLowerCase().includes(q),
      )
    : users;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Superadmin Access Control</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Founder-only, hidden page (not shown in the sidebar). Grant or revoke
          platform superadmin here. Your own account is locked and cannot be
          revoked from this screen. Search for a user before acting.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-600">
          {err}
        </div>
      )}

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
                <th className="px-4 py-3 font-medium text-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-foreground text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => {
                const isMe = isFounderEmail(u.email);
                return (
                  <tr key={u.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {u.full_name || "(no name)"}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.account_name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.is_superadmin ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-600 text-white">
                          Superadmin
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {isMe ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Lock className="size-3.5" />
                            Locked (you)
                          </span>
                        ) : u.is_superadmin ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === u.id}
                            onClick={() => toggleSuperadmin(u)}
                            className="gap-1.5 text-xs border-red-500/40 text-red-600 hover:bg-red-500/10"
                          >
                            <ShieldAlert className="size-3.5" />
                            Revoke
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={updatingId === u.id}
                            onClick={() => toggleSuperadmin(u)}
                            className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <ShieldCheck className="size-3.5" />
                            Grant
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
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

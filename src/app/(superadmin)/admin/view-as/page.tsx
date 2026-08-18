"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  Loader2,
  Check,
  X,
  ShieldCheck,
  Building2,
  UserCircle2,
  AlertTriangle,
} from "lucide-react";
import { getMenuStructure, type MenuNode } from "@/components/layout/sidebar";
import { hasPermission } from "@/lib/auth/rbac";
import type { ModuleSettings } from "@/hooks/use-auth";
import type { AssignmentMode } from "@/hooks/use-extra-settings";

interface TargetUser {
  id: string;
  full_name: string | null;
  email: string;
  account_role: string;
  status: string | null;
  web_access: boolean | null;
  mobile_access: boolean | null;
  employee_role_name: string | null;
  permissions: Record<string, unknown>;
}

interface TargetAccount {
  id: string;
  name: string;
  subscription_plan: string | null;
  module_settings: Record<string, boolean>;
  assignment_mode: AssignmentMode;
  deleted: boolean;
}

interface UserOption {
  id: string;
  full_name: string | null;
  email: string;
  account_id: string;
  account_role: string;
  accounts?: { name: string } | null;
}

export default function ViewAsPage() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [target, setTarget] = useState<TargetUser | null>(null);
  const [account, setAccount] = useState<TargetAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) return;
      const payload = await res.json();
      setUsers(payload.users || []);
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTarget(null);
      setAccount(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/view-as?profileId=${selectedId}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to load");
        setTarget(payload.target);
        setAccount(payload.account);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId]);

  // The real navigation tree, evaluated against the target's permissions and
  // their account's module toggles. Imported from the sidebar rather than
  // copied, so this cannot drift from what users actually see.
  const menu: MenuNode[] = useMemo(() => {
    if (!account) return [];
    return getMenuStructure(
      account.module_settings as unknown as ModuleSettings,
      account.assignment_mode,
    );
  }, [account]);

  const can = (key: string) => hasPermission(target?.permissions as any, key);

  const visibleFor = (item: { module?: string; configModule?: string }) => {
    if (item.configModule && account) {
      const enabled = account.module_settings[item.configModule] ?? true;
      if (!enabled) return { visible: false, reason: `module '${item.configModule}' disabled` };
    }
    if (item.module && !can(`view_${item.module}`)) {
      return { visible: false, reason: `missing permission view_${item.module}` };
    }
    return { visible: true, reason: "" };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Eye className="h-6 w-6 text-primary" />
          View As
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          See exactly what a user sees — menus, permissions and module access —
          without ever signing in as them.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <label className="text-sm font-medium block mb-2">Select a user</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full max-w-xl rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Choose a user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.accounts?.name ?? "—"} · {u.full_name || u.email} ({u.account_role})
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && <div className="text-sm text-red-500">{error}</div>}

      {target && account && !loading && (
        <>
          {/* Identity banner. Required on every View-As screen so there is never
              a moment of doubt about whose view is on screen — and it states
              plainly that the superadmin identity is unchanged. */}
          <div className="sticky top-0 z-20 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Eye className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="flex items-center gap-x-6 gap-y-1 flex-wrap text-sm">
                <span className="font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide text-xs">
                  Viewing as
                </span>
                <span className="flex items-center gap-1.5">
                  <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                  <strong>{target.full_name || target.email}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  {target.employee_role_name ?? "No employee role"}
                  <span className="text-muted-foreground">
                    ({target.account_role})
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {account.name}
                </span>
              </div>
              <span className="ml-auto text-xs px-2 py-1 rounded bg-background/70 border border-border">
                You are still signed in as superadmin
              </span>
            </div>
          </div>

          {/* Account-level blockers that explain a blank screen before
              permissions are even consulted. */}
          {(account.deleted ||
            target.status === "inactive" ||
            target.web_access === false) && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium text-red-600">
                <AlertTriangle className="h-4 w-4" />
                This user cannot sign in at all
              </p>
              <ul className="text-sm text-red-600/90 list-disc pl-6">
                {account.deleted && <li>Their company is soft-deleted</li>}
                {target.status === "inactive" && <li>Their profile is inactive</li>}
                {target.web_access === false && <li>Web access is turned off</li>}
              </ul>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-5">
            {/* Navigation as they see it */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold">Navigation they see</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hidden entries show why they are hidden.
                </p>
              </div>
              <div className="p-3 space-y-1 max-h-[32rem] overflow-y-auto">
                {menu.map((node, i) => {
                  if (node.type === "spacer") return null;

                  if (node.type === "group") {
                    const groupHidden =
                      node.configModule &&
                      account.module_settings[node.configModule] === false;
                    return (
                      <div key={i} className="py-1">
                        <p
                          className={`text-xs font-semibold uppercase tracking-wide px-2 ${
                            groupHidden ? "text-muted-foreground/50 line-through" : "text-muted-foreground"
                          }`}
                        >
                          {node.label}
                        </p>
                        <div className="mt-0.5 space-y-0.5">
                          {node.items.map((item) => {
                            const v = groupHidden
                              ? { visible: false, reason: `module '${node.configModule}' disabled` }
                              : visibleFor(item);
                            return (
                              <Row key={item.href} label={item.label} {...v} />
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const v = visibleFor(node);
                  return <Row key={node.href} label={node.label} {...v} />;
                })}
              </div>
            </div>

            {/* Permission matrix */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold">Granular permissions</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(target.permissions as any)?.all === true
                    ? "This role has the `all` override — every permission is granted."
                    : `${Object.keys(target.permissions || {}).length} keys on role “${target.employee_role_name ?? "none"}”`}
                </p>
              </div>
              <div className="p-3 max-h-[32rem] overflow-y-auto">
                {(target.permissions as any)?.all === true ? (
                  <p className="text-sm text-emerald-600 px-2 py-1">
                    Full access — nothing is restricted for this user.
                  </p>
                ) : Object.keys(target.permissions || {}).length === 0 ? (
                  <p className="text-sm text-amber-600 px-2 py-1">
                    No employee role assigned. Every permission-gated screen will
                    be hidden — this alone explains most “I can’t see anything”
                    reports.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {Object.entries(target.permissions)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <li
                          key={key}
                          className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-muted"
                        >
                          {value === true ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-mono">{key}</span>
                          {typeof value === "string" && (
                            <span className="ml-auto text-muted-foreground">
                              {value}
                            </span>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Module toggles */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">
              Modules enabled for {account.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(account.module_settings).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No overrides — every module defaults to enabled.
                </p>
              ) : (
                Object.entries(account.module_settings).map(([key, on]) => (
                  <span
                    key={key}
                    className={`text-xs px-2 py-1 rounded border ${
                      on
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                        : "bg-muted text-muted-foreground border-border line-through"
                    }`}
                  >
                    {key.replace(/_/g, " ")}
                  </span>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  visible,
  reason,
}: {
  label: string;
  visible: boolean;
  reason: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded ${
        visible ? "" : "opacity-60"
      }`}
    >
      {visible ? (
        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span className={visible ? "" : "line-through"}>{label}</span>
      {!visible && (
        <span className="ml-auto text-xs text-muted-foreground font-mono">
          {reason}
        </span>
      )}
    </div>
  );
}

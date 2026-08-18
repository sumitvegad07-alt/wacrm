"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  Loader2,
  RotateCcw,
  Trash2,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface DeletedAccount {
  id: string;
  name: string;
  subscription_plan: string | null;
  deleted_at: string;
  deleted_by_email: string | null;
  purge_after: string | null;
  users: number;
  orders: number;
  contacts: number;
  purgeable: boolean;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86_400_000);
}

export default function RecoveryCenterPage() {
  const [accounts, setAccounts] = useState<DeletedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedAccount | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recovery");
      const payload = await res.json();
      if (res.ok) setAccounts(payload.accounts);
      else toast.error(payload.error || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (a: DeletedAccount) => {
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/admin/accounts/${a.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Restore failed");
      toast.success(`${a.name} restored`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    if (!purgeTarget || purgeConfirm !== purgeTarget.name) return;
    setBusyId(purgeTarget.id);
    try {
      const res = await fetch(
        `/api/admin/accounts/${purgeTarget.id}/lifecycle?confirm=${encodeURIComponent(purgeConfirm)}`,
        { method: "DELETE" },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Purge failed");
      toast.success(`${purgeTarget.name} permanently deleted`);
      setPurgeTarget(null);
      setPurgeConfirm("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArchiveRestore className="h-6 w-6 text-primary" />
          Recovery Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deleted tenants are hidden from their own users but fully recoverable
          for 90 days. Nothing here has been destroyed yet.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No deleted tenants. Nothing to recover.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const days = daysUntil(a.purge_after);
            return (
              <div
                key={a.id}
                className="bg-card border border-border rounded-xl p-5 flex items-start gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{a.name}</h3>
                    {a.subscription_plan && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {a.subscription_plan}
                      </span>
                    )}
                    {a.purgeable ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/30">
                        Purge window elapsed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {days} days left
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground mt-1">
                    {a.users} users · {a.contacts} contacts · {a.orders} orders
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Deleted {new Date(a.deleted_at).toLocaleString()}
                    {a.deleted_by_email && ` by ${a.deleted_by_email}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={busyId === a.id}
                    onClick={() => restore(a)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    className="gap-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    disabled={!a.purgeable || busyId === a.id}
                    title={
                      a.purgeable
                        ? "Permanently delete"
                        : "Cannot purge until the 90-day window elapses"
                    }
                    onClick={() => {
                      setPurgeTarget(a);
                      setPurgeConfirm("");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Purge
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Purge confirmation */}
      {purgeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-2 text-red-500">
              <ShieldAlert className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Permanently delete</h2>
            </div>

            <p className="text-sm text-muted-foreground">
              This destroys <strong>{purgeTarget.name}</strong> and everything
              belonging to it — {purgeTarget.users} users,{" "}
              {purgeTarget.contacts} contacts, {purgeTarget.orders} orders, and
              all related records across 80 tables.{" "}
              <strong className="text-foreground">
                There is no undo and no backup taken by this action.
              </strong>
            </p>

            <div className="space-y-2">
              <p className="text-sm">
                Type <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  {purgeTarget.name}
                </code>{" "}
                to confirm:
              </p>
              <Input
                value={purgeConfirm}
                onChange={(e) => setPurgeConfirm(e.target.value)}
                placeholder={purgeTarget.name}
              />
            </div>

            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setPurgeTarget(null);
                  setPurgeConfirm("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={purgeConfirm !== purgeTarget.name || busyId !== null}
                onClick={purge}
              >
                {busyId === purgeTarget.id && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Permanently delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

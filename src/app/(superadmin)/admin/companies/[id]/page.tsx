"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, UserCircle2, AlertTriangle, Save, Trash2, ToggleLeft } from "lucide-react";
import { MODULE_KEYS, type ModuleKey } from "@/lib/admin/billing";
import Link from "next/link";

interface Member {
  id: string;
  full_name: string | null;
  email: string;
  account_role: string;
}

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const supabase = createClient();

  const [company, setCompany] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Form states
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [userCount, setUserCount] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [modules, setModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      const [companyRes, membersRes] = await Promise.all([
        supabase.from("accounts").select("*").eq("id", id).single(),
        supabase
          .from("profiles")
          .select("id, full_name, email, account_role")
          .eq("account_id", id)
          .order("account_role"),
      ]);

      if (companyRes.data) {
        const c = companyRes.data;
        setModules((c.module_settings as Record<string, boolean>) ?? {});
        setCompany(c);
        setStatus(c.subscription_status || "active");
        setPlan(c.subscription_plan || "Free");
        setExpiresAt(
          c.subscription_expires_at
            ? c.subscription_expires_at.substring(0, 10)
            : ""
        );
        setUserCount(c.user_count || "");
        setNotes(c.notes || "");
      }
      setMembers(membersRes.data || []);
      setLoading(false);
    }
    load();
  }, [id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);

    // Goes through /api/admin/accounts/[id] rather than updating `accounts`
    // directly. That route validates the change (a seat count below the
    // tenant's real user total would silently lock them out of managing their
    // own team), applies module toggles, and records before/after in the audit
    // log. It also removes the silent-no-op failure mode this screen used to
    // have: an RLS-blocked UPDATE succeeded with no error and changed nothing,
    // while the page reported "Saved successfully!".
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          plan,
          expiresAt: expiresAt || null,
          userCount: userCount === "" ? undefined : Number(userCount),
          modules,
        }),
      });
      const payload = await res.json();

      if (!res.ok || payload.error) {
        setSaveMsg(`Error: ${payload.error || "Save failed"}`);
      } else if (Object.keys(payload.changed || {}).length === 0) {
        setSaveMsg("No changes to save.");
      } else {
        setSaveMsg("Saved successfully!");
      }
      setTimeout(() => setSaveMsg(null), res.ok && !payload.error ? 3000 : 10000);
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
      setTimeout(() => setSaveMsg(null), 10000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== company?.name) return;
    setDeleting(true);

    // Soft delete, not a row delete. Every foreign key referencing `accounts`
    // is ON DELETE CASCADE, so the old code here would have destroyed the
    // tenant across 80 tables with no undo — it only ever appeared safe because
    // it silently affected zero rows (no DELETE policy existed).
    //
    // The tenant becomes invisible to its own users immediately, because
    // is_account_member() now excludes deleted accounts. Permanent destruction
    // lives in the Recovery Center, behind a 90-day window.
    try {
      const res = await fetch(`/api/admin/accounts/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      const payload = await res.json();
      if (!res.ok || payload.error) throw new Error(payload.error || "Delete failed");
      router.push("/admin/recovery");
    } catch (e: any) {
      alert("Error deleting: " + e.message);
      setDeleting(false);
    }
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
      admin: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
      agent: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
      viewer: "bg-muted text-muted-foreground",
    };
    return (
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
          colors[role] || colors["viewer"]
        }`}
      >
        {role}
      </span>
    );
  };

  if (loading) return <p className="text-muted-foreground p-6">Loading...</p>;
  if (!company) return <p className="text-muted-foreground p-6">Company not found.</p>;

  return (
    <div className="max-w-3xl space-y-8">
      <Link
        href="/admin/companies"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Companies
      </Link>

      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{company.name}</h1>
          {company.customer_id && (
            <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20">
              ID: {company.customer_id}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Industry: {company.industry || "Not specified"} · Joined:{" "}
          {new Date(company.created_at).toLocaleDateString("en-IN")}
        </p>
      </div>

      {/* Subscription Settings */}
      <form
        onSubmit={handleSave}
        className="bg-card border border-border rounded-xl p-6 space-y-5"
      >
        <h2 className="text-base font-semibold">Subscription</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v || "")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Free">Free</SelectItem>
                <SelectItem value="Pro">Pro</SelectItem>
                <SelectItem value="Enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v || "")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trialing">Trialing</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="deactivated">Deactivated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Subscription Expiry Date</Label>
          <Input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank for no expiry. Setting status to &quot;Expired&quot; or
            &quot;Deactivated&quot; locks out all users immediately.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Max User Limit</Label>
          <Input
            type="number"
            min="1"
            value={userCount}
            onChange={(e) => setUserCount(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="e.g. 5"
          />
          <p className="text-xs text-muted-foreground">
            Maximum number of staff members this account can have. Leave blank for no limit.
          </p>
        </div>

        {/* Module flags */}
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <ToggleLeft className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Modules</h3>
            <span className="text-xs text-muted-foreground">
              Unset modules default to enabled
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {MODULE_KEYS.map((key: ModuleKey) => {
              const enabled = modules[key] ?? true;
              return (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      setModules((m) => ({ ...m, [key]: e.target.checked }))
                    }
                    className="accent-primary"
                  />
                  <span className={enabled ? "" : "text-muted-foreground line-through"}>
                    {key.replace(/_/g, " ")}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Changes"}
          </Button>
          {saveMsg && (
            <span
              className={`text-sm ${
                saveMsg.startsWith("Error")
                  ? "text-red-500"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {saveMsg}
            </span>
          )}
        </div>
      </form>

      {/* Members */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold">
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3">
                  <UserCircle2 className="h-7 w-7 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {m.full_name || "(no name)"}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
                {roleBadge(m.account_role)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-card border border-red-300 dark:border-red-500/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="text-base font-semibold">Danger Zone</h2>
        </div>

        {!showDelete ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                Delete this company
              </p>
              <p className="text-xs text-muted-foreground">
                Hides the account from its users immediately. Fully recoverable
                for 90 days from the Recovery Center; nothing is destroyed now.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDelete(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Type{" "}
              <strong className="font-mono text-red-500">{company.name}</strong>{" "}
              to confirm deletion:
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={company.name}
              className="border-red-300 dark:border-red-500/40"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={deleteConfirm !== company.name || deleting}
                onClick={handleDelete}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting…" : "Confirm Delete"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirm("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
import { ChevronLeft, UserCircle2, AlertTriangle, Save, Trash2 } from "lucide-react";
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
  const [notes, setNotes] = useState("");

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
        setCompany(c);
        setStatus(c.subscription_status || "active");
        setPlan(c.subscription_plan || "Free");
        setExpiresAt(
          c.subscription_expires_at
            ? c.subscription_expires_at.substring(0, 10)
            : ""
        );
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
    const { error } = await supabase
      .from("accounts")
      .update({
        subscription_status: status,
        subscription_plan: plan,
        subscription_expires_at: expiresAt || null,
      })
      .eq("id", id);

    setSaveMsg(error ? `Error: ${error.message}` : "Saved successfully!");
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleDelete = async () => {
    if (deleteConfirm !== company?.name) return;
    setDeleting(true);
    // Delete profiles first, then account
    await supabase.from("profiles").delete().eq("account_id", id);
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (!error) {
      router.push("/admin/companies");
    } else {
      alert("Error deleting: " + error.message);
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
        <h1 className="text-2xl font-bold">{company.name}</h1>
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
                Permanently removes the account and all its members. This cannot
                be undone.
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Loader2, Trash2, Globe, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Announcement {
  id: string;
  account_id: string | null;
  title: string;
  content: string;
  expiry_date: string | null;
  created_at: string;
}

interface AccountOption {
  id: string;
  name: string;
}

export default function AnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiry, setExpiry] = useState("");
  const [target, setTarget] = useState("all");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [existing, setExisting] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      const payload = await res.json();
      if (res.ok) setExisting(payload.announcements);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const res = await fetch(
        "/api/admin/db/rows?table=accounts&pageSize=200&sort=name&dir=asc",
      );
      if (!res.ok) return;
      const payload = await res.json();
      setAccounts((payload.rows || []).map((r: any) => ({ id: r.id, name: r.name })));
    })();
  }, []);

  const publish = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Title and message are both required");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: message,
          expiry_date: expiry || null,
          account_id: target === "all" ? null : target,
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.error) throw new Error(payload.error || "Failed to publish");

      toast.success(
        target === "all" ? "Published to all tenants" : "Published to tenant",
      );
      setTitle("");
      setMessage("");
      setExpiry("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    const res = await fetch(`/api/admin/announcements?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      load();
    } else {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Announcements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Broadcast notices to all tenants, or to one.
        </p>
      </div>

      {/* Compose */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Compose</h2>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ann-title">Title</Label>
          <Input
            id="ann-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Scheduled maintenance on Sunday"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ann-message">Message</Label>
          <textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="What tenants need to know…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ann-target">Audience</Label>
            <select
              id="ann-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">All tenants</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-expiry">Expires (optional)</Label>
            <Input
              id="ann-expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
        </div>

        <Button onClick={publish} disabled={sending}>
          {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Publish
        </Button>
      </div>

      {/* Published */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Platform announcements</h2>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : existing.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing published yet.
          </p>
        ) : (
          existing.map((a) => {
            const expired =
              a.expiry_date !== null && new Date(a.expiry_date) < new Date();
            return (
              <div
                key={a.id}
                className="bg-card border border-border rounded-xl p-4 flex items-start gap-3"
              >
                {a.account_id === null ? (
                  <Globe className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                ) : (
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{a.title}</p>
                    {expired && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Expired
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                    {a.content}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(a.created_at).toLocaleString()}
                    {a.expiry_date &&
                      ` · expires ${new Date(a.expiry_date).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => remove(a.id)}
                  className="text-muted-foreground hover:text-red-500 shrink-0"
                  aria-label="Delete announcement"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

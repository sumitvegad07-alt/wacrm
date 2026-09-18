"use client";

// Per-user notification preferences (mute toggles).
//
// The admin's role rights decide which categories a user is ELIGIBLE for; this
// screen lets the user silence any category they're eligible for. A category is
// "on" (receiving) unless a notification_preferences row marks it muted. Writes
// go straight to notification_preferences, which the generator + mobile scheduler
// already honour.

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";

const CATEGORIES: { key: string; label: string; desc: string; right: string }[] = [
  {
    key: "task",
    label: "Task reminders & assignments",
    desc: "Reminders when a task is due, and when a task is assigned to you.",
    right: PERMISSIONS.NOTIFICATIONS.RECEIVE_TASK,
  },
  {
    key: "assignment",
    label: "Leads & deals assigned to me",
    desc: "When a lead or deal is assigned to you.",
    right: PERMISSIONS.NOTIFICATIONS.RECEIVE_ASSIGNMENT,
  },
  {
    key: "announcement",
    label: "Announcements",
    desc: "Company announcements published to you.",
    right: PERMISSIONS.NOTIFICATIONS.RECEIVE_ANNOUNCEMENT,
  },
  {
    key: "team_activity",
    label: "Team activity",
    desc: "When your team creates orders, expenses, payments, leads, customers or deals, or completes tasks.",
    right: PERMISSIONS.NOTIFICATIONS.RECEIVE_TEAM_ACTIVITY,
  },
  {
    key: "punch_alarm",
    label: "Punch-in / punch-out alarm",
    desc: "Mobile only — a shift-time alarm reminding you to punch in and out.",
    right: PERMISSIONS.NOTIFICATIONS.RECEIVE_PUNCH_ALARM,
  },
];

export function NotificationPreferencesPanel() {
  const { profile, accountId, hasPermission } = useAuth();
  const supabase = createClient();
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!profile?.id) return;
      const { data } = await supabase
        .from("notification_preferences")
        .select("category, muted")
        .eq("user_id", profile.id);
      if (active && data) {
        const next: Record<string, boolean> = {};
        for (const row of data as { category: string; muted: boolean }[]) next[row.category] = row.muted;
        setMuted(next);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profile?.id, supabase]);

  const entitled = CATEGORIES.filter((c) => hasPermission(c.right));

  const setReceiving = async (key: string, receiving: boolean) => {
    if (!profile?.id) return;
    const nextMuted = !receiving;
    setMuted((prev) => ({ ...prev, [key]: nextMuted }));
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        account_id: accountId,
        user_id: profile.id,
        category: key,
        muted: nextMuted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,category" },
    );
    if (error) {
      toast.error("Could not save preference");
      setMuted((prev) => ({ ...prev, [key]: !nextMuted })); // revert
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which notifications you receive. Your administrator controls which types are
          available to your role.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entitled.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Your role isn&apos;t set up to receive any notifications. Ask your administrator to grant
          notification rights in Team → Roles.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {entitled.map((c) => {
            const receiving = !(muted[c.key] ?? false);
            return (
              <div key={c.key} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
                </div>
                <Switch
                  checked={receiving}
                  onCheckedChange={(v) => setReceiving(c.key, v)}
                  aria-label={`Receive ${c.label}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

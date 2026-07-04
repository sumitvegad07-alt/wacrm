"use client";

import { useState } from "react";
import { Megaphone, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("all");

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Announcements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Broadcast notices to all or specific tenant accounts.
        </p>
      </div>

      {/* Coming Soon Notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-400">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium mb-1">Database migration required</p>
          <p className="text-amber-700 dark:text-amber-500">
            This feature needs an <code className="font-mono text-xs">announcements</code> table
            in Supabase. The form below is a preview — run the migration first to enable sending.
          </p>
        </div>
      </div>

      {/* Compose Form (preview) */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Compose Announcement</h2>
        </div>

        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Scheduled maintenance on July 10"
          />
        </div>

        <div className="space-y-2">
          <Label>Message</Label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Write your announcement here…"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground resize-none"
          />
        </div>

        <div className="space-y-2">
          <Label>Target Audience</Label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-ring text-foreground"
          >
            <option value="all">All Companies</option>
            <option value="Free">Free Plan Only</option>
            <option value="Pro">Pro Plan Only</option>
            <option value="Enterprise">Enterprise Plan Only</option>
          </select>
        </div>

        <Button disabled className="gap-2 opacity-60 cursor-not-allowed">
          <Megaphone className="h-4 w-4" />
          Send Announcement (migration required)
        </Button>
      </div>

      {/* Required Migration */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold mb-3">Required Migration SQL</h2>
        <pre className="bg-muted rounded-lg p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap">
{`-- Run this in your Supabase SQL editor
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_plan TEXT, -- NULL = all plans
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superadmins can manage" ON announcements
  USING (is_superadmin())
  WITH CHECK (is_superadmin());
CREATE POLICY "Authenticated users can read" ON announcements
  FOR SELECT USING (auth.role() = 'authenticated');`}
        </pre>
      </div>
    </div>
  );
}

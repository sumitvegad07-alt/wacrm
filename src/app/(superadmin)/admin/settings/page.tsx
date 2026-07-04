"use client";

import { useAuth } from "@/hooks/use-auth";
import { Settings, Shield, Info } from "lucide-react";

export default function SuperAdminSettingsPage() {
  const { profile, user } = useAuth();

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Superadmin Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform-level configuration and your superadmin profile.
        </p>
      </div>

      {/* Superadmin Profile */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Superadmin Identity</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium text-foreground mt-1">
              {profile?.full_name || "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="font-medium text-foreground mt-1">
              {user?.email || "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Superadmin Status</p>
            <span className="inline-flex items-center mt-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
              ✓ Active
            </span>
          </div>
        </div>
      </div>

      {/* Platform Defaults (coming soon) */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Platform Defaults</h2>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Platform-wide settings (default plan for new signups, trial duration,
            support email) are coming soon. These will be configurable here
            without touching the codebase.
          </p>
        </div>
      </div>
    </div>
  );
}

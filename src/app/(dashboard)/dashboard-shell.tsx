"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AppQueryProvider } from "@/components/providers/query-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { Button } from "@/components/ui/button";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    account,
    hasWhatsApp,
    hasAutomations,
    hasBroadcasts,
    hasLocationTracking,
    isModuleEnabled,
    signOut,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Route protection: restrict direct navigation to disabled module routes
  useEffect(() => {
    if (loading || !user || !pathname) return;

    const isRestricted =
      (pathname.startsWith("/automations") && !hasAutomations) ||
      (pathname.startsWith("/broadcasts") && !hasBroadcasts) ||
      (pathname.startsWith("/locations") && !hasLocationTracking) ||
      (pathname.startsWith("/whatsapp") && (!hasWhatsApp || !isModuleEnabled("whatsapp"))) ||
      (pathname.startsWith("/quotations") && !isModuleEnabled("quotation")) ||
      (pathname.startsWith("/expenses") && !isModuleEnabled("expense")) ||
      (pathname.startsWith("/dispatch") && !isModuleEnabled("dispatch")) ||
      (pathname.startsWith("/routes") && !isModuleEnabled("route"));

    if (isRestricted) {
      router.replace("/dashboard");
    }
  }, [
    loading,
    user,
    pathname,
    hasAutomations,
    hasBroadcasts,
    hasLocationTracking,
    hasWhatsApp,
    isModuleEnabled,
    router,
  ]);

  useEffect(() => {
    if (account && !account.is_provisioned && account.subscription_status === 'active') {
      fetch("/api/provision-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: account.id, industry: account.industry }),
      }).then(() => {
        // Reload page to reflect new data or silently update state
        // To avoid infinite loops, the API updates the DB. Next reload will catch it.
      });
    }
  }, [account]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const now = new Date();
  const expiryDate = account?.subscription_expires_at ? new Date(account.subscription_expires_at) : null;
  const isTimeExpired = expiryDate ? expiryDate < now : false;
  const isExpired = account && (account.subscription_status === 'expired' || account.subscription_status === 'deactivated' || isTimeExpired);

  if (isExpired) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-foreground">Subscription Expired</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Your subscription to the CRM has expired. Please renew it or contact support to restore access to your workspace.
          </p>
          {account?.name && (
            <p className="mb-6 text-xs text-muted-foreground">
              Signed in to <span className="text-foreground font-medium">{account.name}</span>
              {user?.email ? <> as {user.email}</> : null}
            </p>
          )}
          {/* Without this, an expired account is a dead end: the sidebar and
              header never render, so there is no sign-out anywhere on the
              screen and no way to switch to another account. A user with a
              second, perfectly valid workspace is locked out of it entirely and
              the only escape is clearing cookies by hand. */}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
            className="w-full rounded-md border border-border bg-muted px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/70"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {account?.subscription_status === 'trialing' && (
            <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top-2">
              <div>
                <span className="font-bold text-destructive">Your Pro trial ends in 3 days.</span>
                <span className="ml-0 sm:ml-2 mt-1 sm:mt-0 block sm:inline">Upgrade now to avoid losing your AI Auto-Replies, Shared Team Inbox, and active Automations.</span>
              </div>
              <Button size="sm" variant="destructive" className="shrink-0" onClick={() => router.push('/settings?tab=overview')}>
                Keep My Features
              </Button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
      <AuthProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </AuthProvider>
    </AppQueryProvider>
  );
}

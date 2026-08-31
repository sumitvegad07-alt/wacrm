"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AppQueryProvider } from "@/components/providers/query-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { useImportNotifications } from "@/hooks/use-import-notifications";
import { Button } from "@/components/ui/button";
import { AskOzzo } from "@/components/ozzo/ask-ozzo";
import { BrandSplash } from "@/components/shared/brand";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    profile,
    loading,
    account,
    hasWhatsApp,
    hasAutomations,
    hasBroadcasts,
    hasCRM,
    hasWFA,
    hasSFA,
    isModuleEnabled,
    moduleSettingsLoaded,
    hasPermission,
    signOut,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Completion notifications for background imports (Universal Import Framework).
  useImportNotifications();

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
    // Wait for the account's real module settings. Modules that ship OFF by default
    // would otherwise look disabled for the moment before they load, redirecting the
    // user away from a page they are entitled to — which is what made /payments
    // unreachable by direct URL, bookmark or refresh while the sidebar link worked.
    if (loading || !user || !pathname || !moduleSettingsLoaded) return;

    // User Attendance and Leaves live under /location-tracking but are base
    // features on every plan — never block them on the WFA line.
    const isBaseLocationPage =
      pathname.startsWith("/location-tracking/attendance") ||
      pathname.startsWith("/location-tracking/leaves");

    const isRestricted =
      // Module-toggle gated (the plan clamps these off when out of plan)
      (pathname.startsWith("/automations") && !hasAutomations) ||
      (pathname.startsWith("/broadcasts") && !hasBroadcasts) ||
      (pathname.startsWith("/whatsapp") && (!hasWhatsApp || !isModuleEnabled("whatsapp"))) ||
      (pathname.startsWith("/quotations") && !isModuleEnabled("quotation")) ||
      (pathname.startsWith("/expenses") && !isModuleEnabled("expense")) ||
      (pathname.startsWith("/payments") && !isModuleEnabled("payment")) ||
      (pathname.startsWith("/dispatch") && !isModuleEnabled("dispatch")) ||
      (pathname.startsWith("/routes") && !isModuleEnabled("route")) ||
      (pathname.startsWith("/schemes") && !isModuleEnabled("scheme")) ||
      // Product-line gated (Leads/Deals → CRM, Orders → SFA, tracking → WFA).
      // These have no module toggle, so the plan line is the ceiling.
      (pathname.startsWith("/leads") && !hasCRM) ||
      (pathname.startsWith("/pipelines") && !hasCRM) ||
      (pathname.startsWith("/deals") && !hasCRM) ||
      (pathname.startsWith("/orders") && !hasSFA) ||
      (pathname.startsWith("/pending-dispatch") && !hasSFA) ||
      (pathname.startsWith("/location-tracking") && !hasWFA && !isBaseLocationPage) ||
      (pathname.startsWith("/reports/leads") && !hasCRM) ||
      (pathname.startsWith("/reports/deals") && !hasCRM) ||
      (pathname.startsWith("/reports/orders") && !hasSFA) ||
      (pathname.startsWith("/reports/sales") && !hasSFA) ||
      (pathname.startsWith("/reports/ageing") && !hasSFA) ||
      (pathname.startsWith("/reports/visits") && !hasWFA) ||
      (pathname.startsWith("/reports/dsr") && !hasWFA);

    if (isRestricted) {
      router.replace("/dashboard");
    }
  }, [
    loading,
    user,
    pathname,
    hasAutomations,
    hasBroadcasts,
    hasWhatsApp,
    hasCRM,
    hasWFA,
    hasSFA,
    isModuleEnabled,
    moduleSettingsLoaded,
    router,
  ]);

  useEffect(() => {
    // Fire first-load provisioning for a fresh account. New signups start on a
    // 'trialing' status (10-day trial), so 'active' alone would never provision
    // them — include 'trialing' too.
    if (
      account &&
      !account.is_provisioned &&
      (account.subscription_status === 'active' ||
        account.subscription_status === 'trialing')
    ) {
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
    return <BrandSplash />;
  }

  if (!user) return null;

  // Login-surface access (Module-wise RBAC): a member whose Web Portal Access is
  // switched OFF cannot use the web app. Two sources are honored — the per-employee
  // `profiles.web_access` toggle AND the role's `web_access` permission (set in the
  // roles editor "Login Access" section; hasPermission bypasses owner/admin/{all}).
  // Owners are never blocked so an account can't lock its own owner out. A member
  // with no business role assigned is not evaluated against the role permission.
  // Enforced here (client); a server-side check is a future hardening pass.
  const isOwnerAccount = profile?.account_role === "owner";
  const hasBusinessRole = !!(profile as { employee_role_id?: string } | null)?.employee_role_id;
  const webAccessDisabled =
    profile != null &&
    !isOwnerAccount &&
    (
      (profile as { web_access?: boolean }).web_access === false ||
      (hasBusinessRole && !hasPermission("web_access"))
    );

  if (webAccessDisabled) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-foreground">Web access disabled</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Your account does not have access to the web portal. Please use the mobile app, or ask your administrator to enable Web Portal Access for your role.
          </p>
          <button
            type="button"
            onClick={async () => { await signOut(); router.replace("/login"); }}
            className="w-full rounded-md border border-border bg-muted px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/70"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

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

  // Days left in a trial, computed from the real expiry date. Trials are just a
  // normal plan with subscription_expires_at set, so there is no "Pro trial" —
  // the banner is plan-agnostic.
  const trialEndsAt = account?.subscription_expires_at
    ? new Date(account.subscription_expires_at)
    : null;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;

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
                <span className="font-bold text-destructive">
                  {trialDaysLeft === null
                    ? "Your trial is active."
                    : trialDaysLeft === 0
                      ? "Your trial ends today."
                      : `Your trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}.`}
                </span>
                <span className="ml-0 sm:ml-2 mt-1 sm:mt-0 block sm:inline">Contact us to move to a paid plan and keep your features.</span>
              </div>
              <Button size="sm" variant="destructive" className="shrink-0" onClick={() => router.push('/settings?tab=overview')}>
                View my plan
              </Button>
            </div>
          )}
          {children}
        </main>
      </div>
      {/* ASK OZZO — read-only support/implementation copilot, available app-wide. */}
      <AskOzzo />
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

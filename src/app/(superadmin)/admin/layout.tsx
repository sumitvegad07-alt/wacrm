"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import {
  Settings,
  LogOut,
  Users,
  LayoutDashboard,
  Building2,
  CreditCard,
  Megaphone,
  UserCircle2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/billing", label: "Billing & Plans", icon: CreditCard },
  { href: "/admin/users", label: "All Users", icon: Users },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function SuperAdminShellInner({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileLoading, isSuperadmin, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Auth check disabled temporarily for local testing
  }, [user, loading, profileLoading, isSuperadmin, router]);

  // if (loading || profileLoading || !isSuperadmin) {
  //   return (
  //     <div className="flex h-screen items-center justify-center bg-background">
  //       <div className="text-center space-y-2">
  //         <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
  //         <p className="text-sm text-muted-foreground">Loading Super Admin…</p>
  //       </div>
  //     </div>
  //   );
  // }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Super Admin Sidebar */}
      <div className="w-60 border-r border-border bg-card flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">Super Admin</p>
              <p className="text-xs text-muted-foreground leading-tight">WACRM Platform</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/admin"
                ? pathname === "/admin"
                : pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-3 border-t border-border space-y-1">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold uppercase">
              {(profile?.full_name || user?.email || "S")[0]}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {profile?.full_name || "Superadmin"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-md hover:bg-red-500/10 text-red-500 text-sm transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
}

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SuperAdminShellInner>{children}</SuperAdminShellInner>
    </AuthProvider>
  );
}

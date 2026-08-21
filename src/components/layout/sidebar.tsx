"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { useExtraSettings, type AssignmentMode } from "@/hooks/use-extra-settings";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  SlidersHorizontal,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  CalendarOff,
  Workflow,
  X,
  Zap,
  CheckSquare,
  ClipboardList,
  Building2,
  Plus,
  Package,
  ShoppingCart,
  Truck,
  PackageCheck,
  Boxes,
  FileText,
  MapPin,
  Bot,
  Map,
  LineChart,
  ChevronDown,
  Briefcase,
  UserPlus,
  Coins,
  PlugZap,
  Tags,
  Percent,
  KeyRound,
  Wallet,
  Palette,
  LayoutGrid,
  Route as RouteIcon,
  CalendarRange,
  Activity,
  Inbox,
  Filter,
  ArrowUpRight,
  PieChart,
  Target,
  Megaphone,
  HeartPulse,
  Banknote,
  AlertTriangle,
  Clock,
  TrendingUp,
} from "lucide-react";

function isNavItemActive(
  itemHref: string,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams> | null
): boolean {
  if (itemHref.startsWith("/settings")) {
    if (!pathname.startsWith("/settings")) return false;
    const itemTab =
      new URLSearchParams(itemHref.split("?")[1] || "").get("tab") ||
      new URLSearchParams(itemHref.split("?")[1] || "").get("section") ||
      itemHref.split("/settings/")[1];
    if (!itemTab) {
      return pathname.startsWith("/settings");
    }
    const currentTab =
      searchParams?.get("tab") ||
      searchParams?.get("section") ||
      pathname.split("/settings/")[1] ||
      "overview";
    return itemTab === currentTab;
  }
  return (
    pathname === itemHref ||
    (itemHref !== "/dashboard" && pathname.startsWith(itemHref))
  );
}

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);
import type { AccountRole } from "@/lib/auth/roles";
import type { ProductLine } from "@/lib/plans/catalog";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /** RBAC module key for permission checking */
  module?: string;
  /**
   * Admin-configurable module key. When set, this item is only shown if
   * the admin has enabled the corresponding module in Module Settings.
   */
  configModule?: "whatsapp" | "quotation" | "expense" | "dispatch" | "pending_dispatch" | "territory" | "route" | "payment" | "scheme" | "stock";
  /**
   * Product-line entitlement. When set, this item is only shown if the account's
   * plan includes that line (CRM / WFA / SFA). Used for features that aren't
   * gated by an admin module toggle — Leads, Deals, Orders and per-line reports.
   */
  line?: ProductLine;
}

export type MenuNode =
  | ({
      type: "link";
    } & NavItem)
  | {
      type: "group";
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      items: NavItem[];
      configModule?: "whatsapp" | "quotation" | "expense" | "dispatch" | "pending_dispatch" | "territory" | "route" | "payment" | "scheme" | "stock";
      line?: ProductLine;
    }
  | {
      type: "spacer";
    };

/**
 * The navigation tree, exported so the superadmin View-As screen can render
 * exactly what a given user would see rather than maintaining a second copy of
 * this structure that silently drifts out of sync.
 */
export function getMenuStructure(
  moduleSettings: ModuleSettings | undefined,
  assignmentMode: AssignmentMode
): MenuNode[] {
  return [
    // ── My Activity, Dashboard, WhatsApp ──
    {
      type: "link",
      href: "/follow-ups",
      label: "My Activity",
      icon: FileText,
      module: "activities",
    },
    {
      type: "link",
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      module: "dashboard",
    },
    {
      type: "link",
      href: "/announcements",
      label: "Announcement",
      icon: Megaphone,
      // No specific module needed or use "announcements" if defined in RBAC. For now, leave it without module to show for all members, or use a new key.
    },
    {
      type: "group",
      label: "WhatsApp",
      icon: WhatsAppIcon,
      configModule: "whatsapp" as const,
      line: "crm" as const,
      items: [
        { href: "/inbox", label: "Inbox", icon: MessageSquare, module: "whatsapp" },
        { href: "/whatsapp/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "whatsapp" },
        { href: "/broadcasts", label: "Broadcasts", icon: Radio, module: "whatsapp_broadcasts" },
        { href: "/automations", label: "Automations", icon: Zap, module: "whatsapp_automations" },
        { href: "/flows", label: "Flows", icon: Workflow, beta: true, module: "whatsapp_flows" },
        { href: "/settings?tab=templates", label: "Templates", icon: FileText, module: "whatsapp_templates" },
        { href: "/settings?tab=ai", label: "Knowledge base", icon: Bot, module: "ai_assistant" },
      ],
    },

    { type: "spacer" },

    // ── Customer ──
    {
      type: "link",
      href: "/contacts",
      label: "Customer",
      icon: Users,
      module: "contacts",
    },
    { type: "spacer" },

    // ── Product, Quotation ──
    {
      type: "link",
      href: "/products",
      label: "Product",
      icon: Package,
      module: "products",
    },
    {
      type: "link",
      href: "/quotations",
      label: "Quotation",
      icon: FileText,
      module: "orders",
      configModule: "quotation" as const,
    },
    {
      type: "link",
      href: "/schemes",
      label: "Scheme",
      icon: Percent,
      module: "orders",
      // Opt-in module: hidden until an admin enables it in Catalogue Settings.
      configModule: "scheme" as const,
      line: "sfa",
    },
    {
      type: "link",
      href: "/stock",
      label: "Stock",
      icon: Boxes,
      module: "products",
      // Opt-in module: hidden until an admin enables it in Catalogue Settings.
      configModule: "stock" as const,
      line: "sfa",
    },

    { type: "spacer" },

    // ── Expense ──
    {
      type: "link",
      href: "/expenses",
      label: "Expense",
      icon: Coins,
      module: "expenses",
      configModule: "expense" as const,
    },

    { type: "spacer" },

    // ── Payment ──
    {
      type: "link",
      href: "/payments",
      label: "Payment",
      icon: Banknote,
      module: "payments",
      configModule: "payment" as const,
    },

    { type: "spacer" },

    // ── Order, Dispatch, Pending Dispatch ──
    {
      type: "link",
      href: "/orders",
      label: "Order",
      icon: ShoppingCart,
      module: "orders",
      line: "sfa",
    },
    {
      type: "link",
      href: "/dispatches",
      label: "Dispatch",
      icon: Truck,
      module: "orders",
      configModule: "dispatch" as const,
    },
    {
      type: "link",
      href: "/pending-dispatch",
      label: "Pending Dispatch",
      icon: PackageCheck,
      module: "orders",
      configModule: "pending_dispatch" as const,
    },

    { type: "spacer" },

    // ── Lead, Deal ──
    {
      type: "link",
      href: "/leads",
      label: "Lead",
      icon: UserPlus,
      module: "leads",
      line: "crm",
    },
    {
      type: "link",
      href: "/pipelines",
      label: "Deal",
      icon: GitBranch,
      module: "deals",
      line: "crm",
    },

    { type: "spacer" },

    // NOTE: Route Management deliberately has NO top-level sidebar entry (see commit 9e9e213
    // "remove routes from main menu"). Route creation/assignment/approval lives inside the
    // employee panel (Team → Employees → an employee → Routes tab), which is the simpler flow
    // the founder wants. Execution monitoring stays under Location Tracking → Route Monitor.

    // ── Location Tracking (collapsed) ──
    {
      type: "group",
      label: "Location Tracking",
      icon: MapPin,
      items: [
        { href: "/location-tracking/overview", label: "Overview", icon: LayoutDashboard, module: "location_tracking" },
        { href: "/location-tracking/health", label: "Tracking Health", icon: HeartPulse, module: "location_tracking" },
        { href: "/location-tracking/dashboard", label: "Live Feed", icon: MapPin, module: "location_tracking" },
        { href: "/location-tracking/all-locations", label: "All Locations", icon: Map, module: "location_tracking" },
        { href: "/location-tracking/visits", label: "Customer Visits", icon: Building2, module: "location_tracking" },
        // Track report was merged into Tracking Health — one table, nothing lost.
        { href: "/location-tracking/attendance", label: "User Attendance", icon: UsersRound, module: "location_tracking" },
        { href: "/location-tracking/leaves", label: "Leaves", icon: CalendarOff, module: "location_tracking" },
        { href: "/location-tracking/executions", label: "Route Monitor", icon: Activity, module: "location_tracking" },
      ],
    },

    { type: "spacer" },

    // ── Report (collapsed) ──
    {
      type: "group",
      label: "Report",
      icon: LineChart,
      items: [
        { href: "/reports/orders", label: "Order Reports", icon: ShoppingCart, module: "orders", line: "sfa" },
        // Sales = the same report over fully-dispatched (Closed) orders only.
        { href: "/reports/sales", label: "Sales Reports", icon: TrendingUp, module: "orders", line: "sfa" },
        // Gated like the Quotation module itself (see the Quotation nav entry above).
        { href: "/reports/quotations", label: "Quotation Reports", icon: FileText, module: "orders", configModule: "quotation" as const, line: "crm" },
        { href: "/reports/payments", label: "Payment Reports", icon: Banknote, module: "payment_reports", configModule: "payment" as const, line: "sfa" },
        { href: "/reports/leads", label: "Lead Reports", icon: UserPlus, module: "leads", line: "crm" },
        { href: "/reports/deals", label: "Deal Reports", icon: GitBranch, module: "deals", line: "crm" },
        { href: "/reports/visits", label: "Visit Reports", icon: MapPin, module: "location_tracking", line: "wfa" },
        // Dormancy: customers/products with NO orders in the chosen window.
        { href: "/reports/ageing", label: "Ageing Reports", icon: Clock, module: "orders", line: "sfa" },
        // Claims by approval status. Distinct from the "/expenses" entry below,
        // which is the expense LIST, not a report.
        { href: "/reports/expenses", label: "Expense Reports", icon: Coins, module: "expenses", configModule: "expense" as const, line: "wfa" },
        { href: "/reports/tasks", label: "Task Reports", icon: CheckSquare, module: "activities" },
        // One line per rep across every module. Opens on Today, not This Month.
        { href: "/reports/dsr", label: "DSR", icon: ClipboardList, module: "location_tracking", line: "wfa" },
        // Stock is the one PURPOSE-BUILT report here (closing = a live ledger SUM,
        // which the generic document-pivot engine can't express). Opt-in module.
        { href: "/reports/stock", label: "Stock Reports", icon: Boxes, module: "products", configModule: "stock" as const, line: "sfa" },
        // This group (aside from Stock, noted above) holds ONLY reports built on the generic report engine.
        //
        // Four entries were removed on 2026-08-18: "Activity Report"
        // (/follow-ups), "Sales & Deals" (/pipelines), "Expenses Report"
        // (/expenses) and "Location Reports" (/location-tracking/health). None
        // was a report — each was a second link to a module's own list page, and
        // "Expenses Report" sat next to the real "Expense Reports", which is the
        // kind of pairing nobody can tell apart.
        //
        // Every one of those pages is still reachable from its own section:
        // /follow-ups and /pipelines have top-level entries, /expenses is
        // "Expense", and /location-tracking/health is "Tracking Health" under
        // Location Tracking. Nothing was orphaned and no page was deleted.
      ],
    },

    { type: "spacer" },

    // ── Employees (collapsed) ──
    {
      type: "group",
      label: "Employees",
      icon: User,
      items: [
        { href: "/team/employees", label: "Employees", icon: User, module: "team_management" },
        { href: "/team/roles", label: "Employee Roles", icon: Shield, module: "team_management" },
      ],
    },

    { type: "spacer" },

    // ── Custom Fields (collapsed) ──
    {
      type: "group",
      label: "Custom Fields",
      icon: SlidersHorizontal,
      items: [
        { href: "/custom-fields/user", label: "User", icon: User },
        { href: "/custom-fields/contact", label: "Customer", icon: Users },
        { href: "/custom-fields/product", label: "Product", icon: Package },
        { href: "/custom-fields/quotation", label: "Sale Quotation", icon: FileText },
        { href: "/custom-fields/lead", label: "Lead", icon: UserPlus },
        { href: "/custom-fields/deal", label: "Deal", icon: GitBranch },
        { href: "/custom-fields/task", label: "Task", icon: CheckSquare },
        { href: "/custom-fields/customer_visit", label: "Customer Visit", icon: Building2 },
        { href: "/custom-fields/lead_visit", label: "Lead Visit", icon: MapPin },
        { href: "/custom-fields/order", label: "Order", icon: ShoppingCart },
        { href: "/custom-fields/dispatch", label: "Dispatch", icon: Truck },
        { href: "/custom-fields/expense", label: "Expense", icon: Coins },
      ],
    },

    // ── Company Profile ──
    {
      type: "link",
      href: "/company-profile",
      label: "Company Profile",
      icon: Building2,
    },
    
    // ── Subscription ──
    {
      type: "link",
      href: "/subscription",
      label: "Subscription",
      icon: Shield,
    },

    { type: "spacer" },

    // ── Settings (collapsed) ──
    {
      type: "group",
      label: "Settings",
      icon: Settings,
      items: [
        { href: "/settings?tab=module_settings", label: "Organization Settings", icon: Settings },
        { href: "/settings?tab=appearance", label: "Appearance", icon: Palette },
        ...(!moduleSettings || moduleSettings.whatsapp !== false
          ? [{ href: "/settings?tab=whatsapp", label: "Whatsapp", icon: MessageSquare }]
          : []),
        { href: "/settings?tab=fields", label: "Tags", icon: Tags },
        { href: "/settings?tab=document_templates", label: "Template", icon: FileText },
        { href: "/settings?tab=deal_pipelines", label: "Deals", icon: Briefcase },
        { href: "/settings?tab=leads", label: "Leads Settings", icon: Filter },
        { href: "/settings?tab=tasks", label: "Task Settings", icon: CheckSquare },
        { href: "/settings?tab=pricing", label: "Catalogue Settings", icon: Percent },
        ...(!moduleSettings || moduleSettings.expense === true
          ? [{ href: "/settings?tab=expense_types", label: "Expense Settings", icon: Wallet }]
          : []),
        { href: "/settings?tab=leave_types", label: "Leave Settings", icon: CalendarOff },
        ...(!moduleSettings || moduleSettings.payment === true
          ? [{ href: "/settings?tab=payments", label: "Payment Settings", icon: Banknote }]
          : []),
        ...(assignmentMode === 'area' && (!moduleSettings || moduleSettings.territory !== false)
          ? [{ href: "/settings?tab=territories", label: "Territory Master", icon: Map }]
          : []),
        { href: "/settings?tab=api", label: "API Keys & Webhooks", icon: KeyRound },
      ],
    },
  ];
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

function SidebarInner({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    profile,
    profileLoading,
    account,
    accountRole,
    isSuperadmin,
    signOut,
    hasAutomations,
    hasBroadcasts,
    hasLocationTracking,
    hasCRM,
    hasWFA,
    hasSFA,
    hasPermission,
    isModuleEnabled,
    moduleSettings,
  } = useAuth();
  const { assignmentMode } = useExtraSettings();
  const totalUnread = useTotalUnread();

  const menuStructure = useMemo(
    () => getMenuStructure(moduleSettings, assignmentMode),
    [moduleSettings, assignmentMode]
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    WhatsApp: false,
    "Location Tracking": false,
    Report: false,
    User: false,
    "Custom Fields": false,
    Settings: false,
  });

  useEffect(() => {
    menuStructure.forEach((node) => {
      if (node.type === "group") {
        const hasActive = node.items.some((item) =>
          isNavItemActive(item.href, pathname, searchParams)
        );
        if (hasActive) {
          setOpenGroups((prev) => (prev[node.label] ? prev : { ...prev, [node.label]: true }));
        }
      }
    });
  }, [pathname, searchParams, menuStructure]);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const lineEnabled = (line: ProductLine) =>
    line === "crm" ? hasCRM : line === "wfa" ? hasWFA : hasSFA;

  const canViewItem = (item: NavItem): boolean => {
    if (item.module && !hasPermission(`view_${item.module}`)) return false;
    if (item.href === "/broadcasts" && !hasBroadcasts) return false;
    if (item.href === "/automations" && !hasAutomations) return false;
    if (item.href === "/flows" && !hasAutomations) return false;
    // Location Tracking rides the WFA line — EXCEPT User Attendance and Leaves,
    // which are base features on every plan (they just live under this menu
    // group). Keep those two visible even when WFA is off.
    if (item.href.startsWith("/location-tracking") && !hasLocationTracking) {
      const alwaysOn =
        item.href === "/location-tracking/attendance" ||
        item.href === "/location-tracking/leaves";
      if (!alwaysOn) return false;
    }
    // Product-line entitlement (Leads/Deals → CRM, Orders → SFA, per-line reports).
    if (item.line && !lineEnabled(item.line)) return false;
    // Admin-configurable module toggle check
    if (item.configModule && !isModuleEnabled(item.configModule)) return false;
    return true;
  };

  const filteredMenu: MenuNode[] = menuStructure
    .map((node) => {
      if (node.type === "spacer") return node;
      if (node.type === "link") {
        return canViewItem(node) ? node : null;
      }
      // For group nodes, check the group-level line + configModule first
      if (node.line && !lineEnabled(node.line)) return null;
      if (node.configModule && !isModuleEnabled(node.configModule)) return null;
      const items = node.items.filter(canViewItem);
      return items.length > 0 ? { ...node, items } : null;
    })
    .filter((node): node is MenuNode => node !== null);

  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const renderNavLink = (item: NavItem, isTopLevel: boolean) => {
    const isActive = isNavItemActive(item.href, pathname, searchParams);
    const showUnreadDot =
      item.href === "/inbox" && totalUnread > 0 && !isActive;

    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href}
        onClick={onClose}
        className={cn(
          "flex items-center gap-3 rounded-lg transition-all duration-150 group relative",
          isTopLevel
            ? "px-3 py-2 text-sm font-medium"
            : "px-3 py-1.5 text-sm font-medium",
          isActive
            ? isTopLevel
              ? "bg-primary text-primary-foreground font-semibold shadow-sm"
              : "bg-primary/15 text-primary font-semibold"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        <item.icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            isActive
              ? isTopLevel
                ? "text-primary-foreground"
                : "text-primary"
              : "text-muted-foreground group-hover:text-foreground"
          )}
        />
        <span className="flex-1 truncate">{item.label}</span>
        {item.beta && (
          <span
            aria-label="Beta feature"
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
          >
            Beta
          </span>
        )}
        {showUnreadDot && (
          <span
            aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
            className="relative flex h-2 w-2"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        )}
        {[
          "/leads",
          "/contacts",
          "/pipelines",
          "/products",
          "/quotations",
          "/orders",
          "/tasks",
          "/expenses",
          "/payments",
          "/dispatches",
        ].includes(item.href.split("?")[0]) && (
          <button
            type="button"
            onMouseEnter={() => {
              const basePath = item.href.split("?")[0];
              const targetPath = basePath === "/pipelines" ? "/deals/new" : `${basePath}/new`;
              router.prefetch(targetPath);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const basePath = item.href.split("?")[0];
              const targetPath = basePath === "/pipelines" ? "/deals/new" : `${basePath}/new`;
              router.push(targetPath);
              if (onClose) onClose();
            }}
            className={cn(
              "ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
              isActive && isTopLevel
                ? "text-primary-foreground/80 hover:bg-primary-foreground/20 hover:text-primary-foreground"
                : "text-muted-foreground/70 hover:bg-background hover:text-foreground"
            )}
            title={`New ${item.label}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-60 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-16 shrink-0 items-center px-6">
          <Link href="/follow-ups" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              CRM Template for WhatsApp
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-1">
            {filteredMenu.map((node, idx) => {
              if (node.type === "spacer") {
                return (
                  <div key={`spacer-${idx}`} className="my-2" />
                );
              }

              if (node.type === "link") {
                return (
                  <div key={`${node.href}-${node.label}`}>
                    {renderNavLink(node, true)}
                  </div>
                );
              }

              const isOpen = openGroups[node.label];
              const isGroupActive = node.items.some((item) =>
                isNavItemActive(item.href, pathname, searchParams)
              );

              return (
                <div key={node.label} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleGroup(node.label)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors group",
                      isGroupActive
                        ? "text-foreground font-semibold bg-muted/50"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <node.icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isGroupActive
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground"
                        )}
                      />
                      <span className="truncate">{node.label}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        isOpen && "rotate-180 text-foreground"
                      )}
                    />
                  </button>

                  {isOpen && (
                    <ul className="flex flex-col gap-1 ml-7 my-1 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin">
                      {node.items.map((item) => (
                        <li key={`${item.href}-${item.label}`}>
                          {renderNavLink(item, false)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              {isSuperadmin && (
                <>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/admin"
                        onClick={onClose}
                        className="text-primary font-semibold focus:bg-primary/10 focus:text-primary"
                      />
                    }
                  >
                    <Shield className="size-4 text-primary" />
                    Super Admin Portal
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border" />
                </>
              )}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <Suspense fallback={null}>
      <SidebarInner {...props} />
    </Suspense>
  );
}

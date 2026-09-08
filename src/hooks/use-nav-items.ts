"use client";

import { useMemo } from "react";
import { useAuth, type ModuleSettings } from "@/hooks/use-auth";
import { useExtraSettings } from "@/hooks/use-extra-settings";
import { getMenuStructure } from "@/components/layout/sidebar";
import type { ProductLine } from "@/lib/plans/catalog";

export interface FlatNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Parent group label, e.g. "Report" / "Settings"; undefined for top-level links. */
  group?: string;
}

/**
 * Flat, permission/plan-filtered list of every navigable destination the
 * current user can open. Reuses the sidebar's `getMenuStructure` (single source
 * of the nav tree) and mirrors its `canViewItem` gating so the command palette
 * only ever surfaces screens the user is actually allowed to reach.
 */
export function useVisibleNavItems(): FlatNavItem[] {
  const {
    hasPermission,
    hasAutomations,
    hasBroadcasts,
    hasLocationTracking,
    hasCRM,
    hasWFA,
    hasSFA,
    isModuleEnabled,
    moduleSettings,
  } = useAuth();
  const { assignmentMode } = useExtraSettings();

  return useMemo(() => {
    const structure = getMenuStructure(moduleSettings, assignmentMode);

    const lineEnabled = (line: ProductLine) =>
      line === "crm" ? hasCRM : line === "wfa" ? hasWFA : hasSFA;

    const canView = (item: {
      href: string;
      permission?: string;
      module?: string;
      line?: ProductLine;
      configModule?: keyof ModuleSettings;
    }): boolean => {
      if (item.permission && !hasPermission(item.permission)) return false;
      if (item.module && !hasPermission(`view_${item.module}`)) return false;
      if (item.href === "/broadcasts" && !hasBroadcasts) return false;
      if (item.href === "/automations" && !hasAutomations) return false;
      if (item.href === "/flows" && !hasAutomations) return false;
      if (item.href.startsWith("/location-tracking") && !hasLocationTracking) {
        const alwaysOn =
          item.href === "/location-tracking/attendance" ||
          item.href === "/location-tracking/leaves";
        if (!alwaysOn) return false;
      }
      if (item.line && !lineEnabled(item.line)) return false;
      if (item.configModule && !isModuleEnabled(item.configModule)) return false;
      return true;
    };

    const flat: FlatNavItem[] = [];
    const seen = new Set<string>();
    const push = (item: FlatNavItem) => {
      // Dedupe by href+label so a screen linked from two places lists once.
      const key = `${item.href}::${item.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      flat.push(item);
    };

    for (const node of structure) {
      if (node.type === "spacer") continue;
      if (node.type === "link") {
        if (canView(node)) {
          push({ href: node.href, label: node.label, icon: node.icon });
        }
        continue;
      }
      // group
      if (node.line && !lineEnabled(node.line)) continue;
      if (node.configModule && !isModuleEnabled(node.configModule)) continue;
      for (const item of node.items) {
        if (canView(item)) {
          push({
            href: item.href,
            label: item.label,
            icon: item.icon,
            group: node.label,
          });
        }
      }
    }

    return flat;
  }, [
    moduleSettings,
    assignmentMode,
    hasPermission,
    hasAutomations,
    hasBroadcasts,
    hasLocationTracking,
    hasCRM,
    hasWFA,
    hasSFA,
    isModuleEnabled,
  ]);
}

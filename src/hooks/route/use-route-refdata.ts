"use client";

// Route reference-data hooks (Phase 2b): the importable-contacts picker source and the
// account employee list for the assignee picker. Contacts go through the Route SDK; employees
// are a small reference read (dozens–hundreds of rows), not route-domain writes.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getRouteSdk, type ImportableContactsParams } from "@/lib/route";
import { routeKeys } from "./query-keys";

/** Paginated + searchable contacts for the "Select customers" import picker. */
export function useImportableContacts(params: ImportableContactsParams | null | undefined) {
  return useQuery({
    queryKey: routeKeys.importableContacts(
      params?.accountId ?? "none",
      params?.search ?? "",
      params?.offset ?? 0
    ),
    queryFn: () => getRouteSdk().searchImportableContacts(params as ImportableContactsParams),
    enabled: !!params?.accountId,
    placeholderData: keepPreviousData,
  });
}

export interface RouteSettingsLite {
  approval_mode: "none" | "manager" | "admin";
  capacity: { max_customers: number; enforcement: "warn" | "block" };
}

/** Account route behavior settings (approval mode, capacity) — read via the settings API. */
export function useRouteSettings(enabled = true) {
  return useQuery({
    queryKey: ["route-settings"],
    queryFn: async (): Promise<RouteSettingsLite> => {
      const res = await fetch("/api/account/route-settings");
      if (!res.ok) throw new Error("Failed to load route settings");
      const json = await res.json();
      return json.route_settings as RouteSettingsLite;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface AccountEmployee {
  id: string;
  full_name: string | null;
}

export interface AccountEmployeesPage {
  rows: AccountEmployee[];
  total: number;
}

/** Paginated + searchable active employees — the Planner board's salesman rows (500+ scale). */
export function useAccountEmployeesPaged(params: {
  accountId: string | null | undefined;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const { accountId, search, limit = 20, offset = 0 } = params;
  return useQuery({
    queryKey: ["account-employees-paged", accountId ?? "none", search ?? "", limit, offset],
    queryFn: async (): Promise<AccountEmployeesPage> => {
      let q = createClient()
        .from("profiles")
        .select("id, full_name", { count: "exact" })
        .eq("account_id", accountId as string)
        .eq("status", "active");
      const s = (search ?? "").trim();
      if (s) q = q.ilike("full_name", `%${s}%`);
      const { data, error, count } = await q
        .order("full_name", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return { rows: (data ?? []) as AccountEmployee[], total: count ?? 0 };
    },
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

/** Active employees (profiles) for the account — the assignee picker source. */
export function useAccountEmployees(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ["account-employees", accountId ?? "none"],
    queryFn: async (): Promise<AccountEmployee[]> => {
      const { data, error } = await createClient()
        .from("profiles")
        .select("id, full_name")
        .eq("account_id", accountId as string)
        .eq("status", "active")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AccountEmployee[];
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

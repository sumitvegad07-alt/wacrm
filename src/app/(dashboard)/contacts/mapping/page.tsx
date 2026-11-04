"use client";

/**
 * Customer mapping — step 4 of secondary sales.
 *
 * Why this screen exists at all: before it, a customer's level and supplier
 * could only be set one customer at a time, on the customer's own page. The
 * founder has 39 customers on his own tenant and there are 1,165 across all
 * tenants, so "open each one and set a level" is not a thing anybody does. The
 * settings card can say 9 customers have no level; this is where that gets
 * fixed.
 *
 * Two tabs, because there are two different jobs:
 *
 *   By area    — say who holds each level in each area, which is what area
 *                mapping reads. "In 150 Feet Ring Road the Distributor is C."
 *   Customers  — set levels and suppliers directly, for many customers at once,
 *                and see who is still missing one.
 *
 * Admin-only, matching the database: customer_channel_parents is writable by
 * admins and the re-map RPC refuses anybody else.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Upload, Users } from "lucide-react";
import { toast } from "sonner";

import { PageLayout, PageHeader, PageLoader, TableSkeleton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NavButton } from "@/components/ui/nav-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportWizard } from "@/components/import/import-wizard";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/errors/message";
import { cn } from "@/lib/utils";
import {
  readMappingMode,
  readSetupStatus,
  type MappingMode,
  type SecondarySalesSetup,
} from "@/lib/customers/mapping";

type Level = { position: number; name: string; color?: string };

type CustomerRow = {
  id: string;
  company: string | null;
  name: string | null;
  hierarchy_level: number | null;
  territory_id: string | null;
  parent_id: string | null;
  parent_locked: boolean | null;
  is_active: boolean | null;
};

type TerritoryRow = { id: string; name: string; level: number; parent_id: string | null };

type ChannelRow = { territory_id: string; hierarchy_level: number; parent_contact_id: string };

/** "Ahmedabad" -> "Gujarat / Ahmedabad", so two areas with the same name are telling apart. */
function territoryPath(id: string, byId: Map<string, TerritoryRow>): string {
  const parts: string[] = [];
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard < 8) {
    const t = byId.get(cur);
    if (!t) break;
    parts.unshift(t.name);
    cur = t.parent_id;
    guard += 1;
  }
  return parts.join(" / ");
}

function labelOf(c: { company: string | null; name: string | null } | undefined): string {
  if (!c) return "—";
  return c.company?.trim() || c.name?.trim() || "Unnamed";
}

export default function CustomerMappingPage() {
  const supabase = createClient();
  // canEditSettings, NOT isAdmin: isAdmin is `role === 'admin'` exactly and
  // deliberately EXCLUDES the owner, so gating on it locked the account owner —
  // the founder — out of his own mapping screen. canEditSettings is the
  // admin-and-above check, and it matches the database, where
  // is_account_member(account_id, 'admin') means "admin or above".
  //
  // profileLoading matters too: the role is null until the profile row
  // settles, so without it the gate flashes for everybody on first paint.
  const { accountId, account, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [territories, setTerritories] = useState<TerritoryRow[]>([]);
  const [channel, setChannel] = useState<ChannelRow[]>([]);
  const [setup, setSetup] = useState<SecondarySalesSetup | null>(null);
  const [saving, setSaving] = useState(false);
  // True when 20261104130000 has not been applied to this project yet. The
  // screen still works for levels and suppliers — those columns are old — but
  // parent_locked and the area tables are not there, and an empty table with no
  // explanation is exactly how a working feature gets reported as broken.
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [areaQuery, setAreaQuery] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [custFilter, setCustFilter] = useState<"all" | "no_level" | "no_parent">("all");
  const [bulkParent, setBulkParent] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLevel, setBulkLevel] = useState<string>("");

  // Free: account.settings is already in context, and re-fetching the account
  // row here would be one more Mumbai round trip per visit for nothing.
  const settings = account?.settings;
  const mode: MappingMode = readMappingMode(settings);
  const hierarchyEnabled = Boolean(
    (settings as { order_settings?: { hierarchy_enabled?: boolean } } | null)?.order_settings
      ?.hierarchy_enabled,
  );
  const levels: Level[] = useMemo(() => {
    const raw = (settings as { order_settings?: { levels?: Level[] } } | null)?.order_settings
      ?.levels;
    return Array.isArray(raw) ? raw.filter((l) => (l.name ?? "").trim()) : [];
  }, [settings]);

  /** Levels that can hold a channel position: everyone except the bottom, who supplies nobody. */
  const holderLevels = useMemo(() => levels.slice(0, Math.max(0, levels.length - 1)), [levels]);

  const territoryById = useMemo(
    () => new Map(territories.map((t) => [t.id, t])),
    [territories],
  );
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const channelKey = (territoryId: string, level: number) => `${territoryId}:${level}`;
  const channelMap = useMemo(
    () => new Map(channel.map((r) => [channelKey(r.territory_id, r.hierarchy_level), r.parent_contact_id])),
    [channel],
  );

  /** How many customers sit in each territory, so the area list can lead with the ones that matter. */
  const customersPerTerritory = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) {
      if (c.territory_id) m.set(c.territory_id, (m.get(c.territory_id) ?? 0) + 1);
    }
    return m;
  }, [customers]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    (async () => {
      setLoading(true);
      // Paged explicitly: a raw select silently caps at 1,000 rows, and a
      // half-read customer list here would quietly under-report who is
      // unmapped — the number this screen exists to show.
      const pageAll = async <T,>(table: string, cols: string): Promise<T[]> => {
        const out: T[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from(table)
            .select(cols)
            .eq("account_id", accountId)
            .range(from, from + 999);
          if (error) throw error;
          const batch = (data ?? []) as T[];
          out.push(...batch);
          if (batch.length < 1000) return out;
        }
      };

      try {
        // parent_locked is new. Ask for it, and fall back to the columns that
        // have always existed so the screen still does its main job on a
        // project where the migration has not been applied.
        const custWithLock = pageAll<CustomerRow>(
          "contacts",
          "id, company, name, hierarchy_level, territory_id, parent_id, parent_locked, is_active",
        ).catch(async () => {
          if (active) setMigrationMissing(true);
          return pageAll<CustomerRow>(
            "contacts",
            "id, company, name, hierarchy_level, territory_id, parent_id, is_active",
          );
        });

        const [cust, terr, chan, status] = await Promise.all([
          custWithLock,
          pageAll<TerritoryRow>("territories", "id, name, level, parent_id"),
          pageAll<ChannelRow>(
            "customer_channel_parents",
            "territory_id, hierarchy_level, parent_contact_id",
          ).catch(() => {
            if (active) setMigrationMissing(true);
            return [] as ChannelRow[];
          }),
          supabase.rpc("secondary_sales_setup_status", { p_account_id: accountId }),
        ]);
        if (!active) return;
        // Deactivated customers are excluded, matching
        // secondary_sales_setup_status — otherwise the table listed 39 rows
        // while the badge above it said 38, which just looks broken.
        setCustomers(cust.filter((c) => c.is_active !== false));
        setTerritories(terr);
        setChannel(chan);
        setSetup(status.error ? null : readSetupStatus(status.data));
      } catch (err) {
        if (active) toast.error(errorMessage(err, "Could not load customer mapping."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [accountId, supabase, refreshKey]);

  const refreshAll = useCallback(() => setRefreshKey((k) => k + 1), []);

  /** Who may hold `level` — the customers actually at it. */
  const holdersAt = useCallback(
    (level: number) =>
      customers
        .filter((c) => c.hierarchy_level === level)
        .sort((a, b) => labelOf(a).localeCompare(labelOf(b))),
    [customers],
  );

  async function setChannelHolder(territoryId: string, level: number, contactId: string | null) {
    if (!accountId) return;
    setSaving(true);
    try {
      if (contactId) {
        const { error } = await supabase.from("customer_channel_parents").upsert(
          {
            account_id: accountId,
            territory_id: territoryId,
            hierarchy_level: level,
            parent_contact_id: contactId,
          },
          { onConflict: "territory_id,hierarchy_level" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("customer_channel_parents")
          .delete()
          .eq("territory_id", territoryId)
          .eq("hierarchy_level", level);
        if (error) throw error;
      }
      // The database re-parents every customer under this area by trigger, so
      // the whole screen is re-read rather than patched in place — anything
      // else would show stale suppliers for rows that really did change.
      refreshAll();
      toast.success(contactId ? "Supplier set for this area." : "Supplier cleared for this area.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save that."));
    } finally {
      setSaving(false);
    }
  }

  async function setCustomerLevel(ids: string[], level: number | null) {
    if (ids.length === 0) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ hierarchy_level: level })
        .in("id", ids);
      if (error) throw error;
      refreshAll();
      setSelected(new Set());
      toast.success(
        ids.length === 1
          ? "Customer level updated."
          : `Level set on ${ids.length} customers.`,
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not set the level."));
    } finally {
      setSaving(false);
    }
  }

  async function setManyParents(ids: string[], parentId: string | null) {
    if (ids.length === 0) return;
    setSaving(true);
    try {
      const patch =
        mode === "area"
          ? { parent_id: parentId, parent_locked: parentId != null }
          : { parent_id: parentId };
      const { error } = await supabase.from("contacts").update(patch).in("id", ids);
      if (error) throw error;
      refreshAll();
      setSelected(new Set());
      setBulkParent("");
      toast.success(`Supplier set on ${ids.length} customer${ids.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not set the supplier."));
    } finally {
      setSaving(false);
    }
  }

  async function setCustomerParent(id: string, parentId: string | null) {
    setSaving(true);
    try {
      // In area mode a hand-picked supplier is an override, so it is locked —
      // otherwise the next area change would silently undo it. Clearing it
      // hands the customer back to the area rule.
      const patch =
        mode === "area"
          ? { parent_id: parentId, parent_locked: parentId != null }
          : { parent_id: parentId };
      const { error } = await supabase.from("contacts").update(patch).eq("id", id);
      if (error) throw error;
      refreshAll();
      toast.success(parentId ? "Supplier set." : "Supplier cleared.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not set the supplier."));
    } finally {
      setSaving(false);
    }
  }

  async function unlockCustomer(id: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ parent_locked: false })
        .eq("id", id);
      if (error) throw error;
      refreshAll();
      toast.success("Back to following the area.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not unlock that customer."));
    } finally {
      setSaving(false);
    }
  }

  // ── Area rows: the ones worth showing ──────────────────────
  // Every territory would be hundreds of rows on a real tenant, most of them
  // empty. Shown: anything holding customers, anything already carrying a
  // channel row, and anything matching the search.
  const areaRows = useMemo(() => {
    const q = areaQuery.trim().toLowerCase();
    return territories
      .filter((t) => {
        if (q) return territoryPath(t.id, territoryById).toLowerCase().includes(q);
        return (
          (customersPerTerritory.get(t.id) ?? 0) > 0 ||
          holderLevels.some((l) => channelMap.has(channelKey(t.id, l.position)))
        );
      })
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }, [territories, territoryById, areaQuery, customersPerTerritory, holderLevels, channelMap]);

  const needsLevel = useMemo(
    () => customers.filter((c) => c.hierarchy_level == null),
    [customers],
  );
  const needsParent = useMemo(
    () => customers.filter((c) => c.hierarchy_level != null && c.hierarchy_level > 1 && !c.parent_id),
    [customers],
  );

  const custRows = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    const base =
      custFilter === "no_level" ? needsLevel : custFilter === "no_parent" ? needsParent : customers;
    return base
      .filter((c) => (q ? labelOf(c).toLowerCase().includes(q) : true))
      .sort((a, b) => (a.hierarchy_level ?? 99) - (b.hierarchy_level ?? 99) || labelOf(a).localeCompare(labelOf(b)));
  }, [customers, custQuery, custFilter, needsLevel, needsParent]);

  /**
   * Suppliers offered for a bulk change.
   *
   * Only when every selected customer sits at the SAME level, because "who may
   * supply this one" is answered by their level and a mixed selection has no
   * single answer. Offering a list that is wrong for half the selection would
   * just produce refusals from the database.
   */
  const bulkSupplierOptions = useMemo(() => {
    const picked = [...selected].map((id) => customerById.get(id)).filter(Boolean) as CustomerRow[];
    if (picked.length === 0) return null;
    const levels = new Set(picked.map((c) => c.hierarchy_level));
    if (levels.size !== 1) return null;
    const level = picked[0].hierarchy_level;
    if (level == null || level <= 1) return null;
    return customers
      .filter((c) => c.hierarchy_level != null && c.hierarchy_level < level)
      .filter((c) => !selected.has(c.id))
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  }, [selected, customerById, customers]);

  if (profileLoading) {
    return (
      <PageLayout>
        <PageHeader title="Customer mapping" />
        <PageLoader />
      </PageLayout>
    );
  }

  if (!canEditSettings) {
    return (
      <PageLayout>
        <PageHeader title="Customer mapping" />
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Only an account admin can set up the distribution channel.
        </div>
      </PageLayout>
    );
  }

  if (!hierarchyEnabled) {
    return (
      <PageLayout>
        <PageHeader title="Customer mapping" />
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">Secondary sales is switched off</p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Turn it on first, name your customer levels and choose how customers are mapped. Then
            come back here to set the chain.
          </p>
          <NavButton href="/settings?tab=organization" size="sm" className="mt-3">
            Open Secondary sales
          </NavButton>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Customer mapping"
        subtitle={
          mode === "area"
            ? "Who holds each level in each area, and therefore who supplies whom."
            : "Each customer's level and who supplies them."
        }
      />

      {migrationMissing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Area mapping is not switched on in the database yet
          </p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Levels and suppliers below work normally. Mapping by area, hand-locked suppliers and
            the readiness counts need migration{" "}
            <code className="font-mono">20261104130000_customer_area_channel_mapping.sql</code>{" "}
            to be applied to this project first.
          </p>
        </div>
      )}

      {setup && (
        <div className="flex flex-wrap gap-2">
          <Badge variant={setup.no_level > 0 ? "destructive" : "secondary"}>
            {setup.no_level} with no level
          </Badge>
          <Badge variant={setup.no_parent > 0 ? "destructive" : "secondary"}>
            {setup.no_parent} with no supplier
          </Badge>
          {mode === "area" && setup.no_area > 0 && (
            <Badge variant="outline">{setup.no_area} with no area</Badge>
          )}
          {setup.locked > 0 && <Badge variant="outline">{setup.locked} set by hand</Badge>}
          <Badge variant="outline">{setup.total} customers</Badge>
        </div>
      )}

      {loading ? (
        <TableSkeleton columns={5} rows={8} />
      ) : (
        <Tabs defaultValue={mode === "area" ? "areas" : "customers"} className="w-full">
          <TabsList>
            {mode === "area" && (
              <TabsTrigger value="areas">
                <MapPin className="mr-1.5 size-3.5" /> By area
              </TabsTrigger>
            )}
            <TabsTrigger value="customers">
              <Users className="mr-1.5 size-3.5" /> Customers
            </TabsTrigger>
          </TabsList>

          {/* ── By area ──────────────────────────────────────── */}
          {mode === "area" && (
            <TabsContent value="areas" className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-caption text-muted-foreground">
                  Set who holds each level in an area. Every customer in that area takes the level
                  directly above their own, automatically. Set it once on a <strong>City</strong>{" "}
                  and the areas under it inherit; set it on one area to override just that area.
                  The bottom level is not listed — they supply nobody.
                </p>
              </div>

              <Input
                value={areaQuery}
                onChange={(e) => setAreaQuery(e.target.value)}
                placeholder="Search areas…"
                className="max-w-sm"
              />

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Area</th>
                      <th className="px-3 py-2 text-left font-medium">Customers</th>
                      {holderLevels.map((l) => (
                        <th key={l.position} className="px-3 py-2 text-left font-medium">
                          {l.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {areaRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={2 + holderLevels.length}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          {areaQuery
                            ? "No area matches that."
                            : "No area has any customers yet. Tag your customers to an area first."}
                        </td>
                      </tr>
                    )}
                    {areaRows.map((t) => (
                      <tr key={t.id} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <span className="font-medium">{t.name}</span>
                          <span className="block text-caption text-muted-foreground">
                            {territoryPath(t.id, territoryById)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {customersPerTerritory.get(t.id) ?? 0}
                        </td>
                        {holderLevels.map((l) => {
                          const current = channelMap.get(channelKey(t.id, l.position)) ?? "";
                          const options = holdersAt(l.position);
                          return (
                            <td key={l.position} className="px-3 py-2">
                              <select
                                value={current}
                                disabled={saving}
                                onChange={(e) =>
                                  void setChannelHolder(t.id, l.position, e.target.value || null)
                                }
                                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-body"
                              >
                                <option value="">Not set</option>
                                {options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {labelOf(o)}
                                  </option>
                                ))}
                              </select>
                              {options.length === 0 && (
                                <span className="mt-0.5 block text-caption text-muted-foreground">
                                  No customer is a {l.name} yet
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          )}

          {/* ── Customers ────────────────────────────────────── */}
          <TabsContent value="customers" className="space-y-3">
            {/* What to do, in the order it has to be done. Levels first: a
                customer with no level has no rule for who may supply them, so
                the supplier box stays closed until one is set. */}
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-caption text-muted-foreground">
                <strong>1.</strong> Give every customer a level.{" "}
                <strong>2.</strong> Say who supplies them. Tick several rows to set either in one
                go, or use the filters to work through only what is missing.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customers…"
                className="max-w-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["all", `All ${customers.length}`],
                  ["no_level", `Needs a level ${needsLevel.length}`],
                  ["no_parent", `Needs a supplier ${needsParent.length}`],
                ] as const).map(([key, label]) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={custFilter === key ? "default" : "outline"}
                    onClick={() => {
                      setCustFilter(key);
                      setSelected(new Set());
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setImportOpen(true)}
                className="ml-auto"
              >
                <Upload className="mr-1 size-3.5" /> Import levels &amp; suppliers
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
                  <span className="text-caption text-muted-foreground">
                    {selected.size} selected
                  </span>
                  <select
                    value={bulkLevel}
                    onChange={(e) => setBulkLevel(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-body"
                  >
                    <option value="">Set level to…</option>
                    {levels.map((l) => (
                      <option key={l.position} value={String(l.position)}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!bulkLevel || saving}
                    onClick={() =>
                      void setCustomerLevel([...selected], bulkLevel ? Number(bulkLevel) : null)
                    }
                  >
                    Apply
                  </Button>
                  {bulkSupplierOptions && bulkSupplierOptions.length > 0 && (
                    <>
                      <select
                        value={bulkParent}
                        onChange={(e) => setBulkParent(e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-body"
                      >
                        <option value="">Set supplier to…</option>
                        {bulkSupplierOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {labelOf(o)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={!bulkParent || saving}
                        onClick={() => void setManyParents([...selected], bulkParent || null)}
                      >
                        Apply
                      </Button>
                    </>
                  )}
                  {selected.size > 0 && bulkSupplierOptions === null && (
                    <span className="text-caption text-muted-foreground">
                      Pick customers that are all at the same level to set their supplier together.
                    </span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={custRows.length > 0 && selected.size === custRows.length}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? new Set(custRows.map((c) => c.id)) : new Set(),
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Level</th>
                    <th className="px-3 py-2 text-left font-medium">Area</th>
                    <th className="px-3 py-2 text-left font-medium">Supplied by</th>
                  </tr>
                </thead>
                <tbody>
                  {custRows.map((c) => {
                    const parent = c.parent_id ? customerById.get(c.parent_id) : undefined;
                    const isTop = c.hierarchy_level === 1;
                    return (
                      <tr key={c.id} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${labelOf(c)}`}
                            checked={selected.has(c.id)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{labelOf(c)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={c.hierarchy_level ?? ""}
                            disabled={saving}
                            onChange={(e) =>
                              void setCustomerLevel(
                                [c.id],
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            className={cn(
                              "rounded-md border bg-background px-2 py-1.5 text-body",
                              c.hierarchy_level == null
                                ? "border-amber-500/50"
                                : "border-border",
                            )}
                          >
                            <option value="">Not set</option>
                            {levels.map((l) => (
                              <option key={l.position} value={String(l.position)}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.territory_id ? territoryPath(c.territory_id, territoryById) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {isTop ? (
                            <span className="text-muted-foreground">Top of the chain</span>
                          ) : (
                            <div className="space-y-1">
                              <select
                                value={c.parent_id ?? ""}
                                disabled={saving || c.hierarchy_level == null}
                                onChange={(e) =>
                                  void setCustomerParent(c.id, e.target.value || null)
                                }
                                className={cn(
                                  "w-full rounded-md border bg-background px-2 py-1.5 text-body",
                                  c.parent_id == null && c.hierarchy_level != null
                                    ? "border-amber-500/50"
                                    : "border-border",
                                )}
                              >
                                <option value="">
                                  {c.hierarchy_level == null ? "Set a level first" : "Not set"}
                                </option>
                                {levels
                                  .filter(
                                    (l) =>
                                      c.hierarchy_level != null && l.position < c.hierarchy_level,
                                  )
                                  .flatMap((l) => holdersAt(l.position))
                                  .filter((o) => o.id !== c.id)
                                  .map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {labelOf(o)}
                                    </option>
                                  ))}
                              </select>
                              {mode === "area" && c.parent_locked && (
                                <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                                  Set by hand
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-caption"
                                    disabled={saving}
                                    onClick={() => void unlockCustomer(c.id)}
                                  >
                                    — follow the area again
                                  </Button>
                                </span>
                              )}
                              {mode === "area" && !c.parent_locked && parent && (
                                <span className="block text-caption text-muted-foreground">
                                  From the area
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {custRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        No customer matches that.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* The ordinary customer importer. A file carrying Customer Level and
          Supplier Code updates existing customers by their code or phone, which
          is the only practical way to map hundreds of them. */}
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="contacts"
        onImported={refreshAll}
      />
    </PageLayout>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Tag, Power, PowerOff, MoreHorizontal, Copy } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageLayout, PageHeader, PageToolbar, EmptyState, StatusBadge, ConfirmDialog, BulkActionBar } from "@/components/shared";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { getSchemes, setSchemeActive } from "@/lib/schemes/api";
import {
  SCHEME_TYPE_LABELS,
  schemeStatus,
  usesValueBounds,
  type SchemeSlabRow,
  type SchemeStatus,
  type SchemeWithDetails,
} from "@/lib/schemes/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** One-line summary of a scheme's bands, for the table. */
function summariseSlabs(scheme: SchemeWithDetails): string {
  const useValue = usesValueBounds(scheme.scheme_type);
  const band = (s: SchemeSlabRow) => {
    const lo = useValue ? s.min_value : s.min_qty;
    const hi = useValue ? s.max_value : s.max_qty;
    const loTxt = useValue ? `₹${lo ?? 0}` : `${lo ?? 0}`;
    return hi == null ? `${loTxt}+` : `${loTxt}–${useValue ? "₹" : ""}${hi}`;
  };
  const reward = (s: SchemeSlabRow) => {
    switch (s.reward_type) {
      case "free_goods": return `${s.free_qty ?? 0} free`;
      case "discount_percent": return `${s.reward_value ?? 0}%`;
      case "discount_amount": return `₹${s.reward_value ?? 0}/unit`;
      case "special_price": return `@₹${s.reward_value ?? 0}`;
      default: return "";
    }
  };
  return scheme.slabs.map((s) => `${band(s)} → ${reward(s)}`).join(", ") || "—";
}

const STATUS_LABEL: Record<SchemeStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

export function SchemeManager() {
  const router = useRouter();
  const { account, canEditSettings, isModuleEnabled } = useAuth();
  const accountId = account?.id ?? null;

  const [schemes, setSchemes] = useState<SchemeWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SchemeWithDetails | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  async function bulkDeactivate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) await setSchemeActive(id, false);
      toast.success(`${ids.length} scheme(s) moved to Inactive.`);
      setSelectedIds(new Set());
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update.");
    } finally {
      setBusy(false);
      setBulkOpen(false);
    }
  }

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setSchemes(await getSchemes(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load schemes.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schemes;
    return schemes.filter((s) => s.name.toLowerCase().includes(q) || SCHEME_TYPE_LABELS[s.scheme_type].toLowerCase().includes(q));
  }, [schemes, search]);

  const today = todayISO();

  async function toggleActive(scheme: SchemeWithDetails) {
    try {
      await setSchemeActive(scheme.id, !scheme.active);
      toast.success(scheme.active ? "Scheme deactivated." : "Scheme activated.");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      // Soft delete — mark Inactive rather than hard-delete, so it can be re-activated.
      await setSchemeActive(deleteTarget.id, false);
      toast.success("Scheme moved to Inactive.");
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to deactivate.");
    } finally {
      setBusy(false);
    }
  }

  // Belt-and-suspenders: the dashboard shell already redirects when the module
  // is off, but guard here too so the page never renders for a disabled module.
  // Placed after all hooks to respect the Rules of Hooks.
  if (!isModuleEnabled("scheme")) return null;

  return (
    <PageLayout>
      <PageHeader
        title="Schemes"
        subtitle="Promotions the salesman is offered at order entry — quantity slabs, free goods and order-value discounts."
        actions={
          canEditSettings ? (
            <Button onClick={() => router.push("/schemes/new")}>
              <Plus className="h-4 w-4 mr-1" /> New scheme
            </Button>
          ) : null
        }
      />

      <PageToolbar>
        <Input
          placeholder="Search schemes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </PageToolbar>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading schemes…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-8 w-8" />}
          title={schemes.length === 0 ? "No schemes yet" : "No schemes match your search"}
          description={
            schemes.length === 0
              ? "Create your first promotion — a quantity slab, free goods, or an order-value discount."
              : "Try a different search."
          }
        />
      ) : (
        <>
        {canEditSettings && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            onClear={() => setSelectedIds(new Set())}
            actions={[{ label: "Move to Inactive", icon: <Trash2 className="size-3.5" />, variant: "destructive", onClick: () => setBulkOpen(true) }]}
          />
        )}
        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {canEditSettings && (
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map((s) => s.id)) : new Set())}
                      aria-label="Select all schemes"
                    />
                  </TableHead>
                )}
                {canEditSettings && <TableHead className="w-24">Action</TableHead>}
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Bands</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Priority</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const status = schemeStatus(s, today);
                return (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/schemes/${s.id}`)}
                  >
                    {canEditSettings && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary align-middle"
                          checked={selectedIds.has(s.id)}
                          onChange={(e) => setSelectedIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })}
                        />
                      </TableCell>
                    )}
                    {canEditSettings && (
                      <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          isInactive={!s.active}
                          onEdit={() => router.push(`/schemes/${s.id}/edit`)}
                          onDelete={() => setDeleteTarget(s)}
                          onReactivate={() => toggleActive(s)}
                          deleteTitle="Deactivate"
                          reactivateTitle="Activate"
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{SCHEME_TYPE_LABELS[s.scheme_type]}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate" title={summariseSlabs(s)}>
                      {summariseSlabs(s)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.scheme_type === "value_slab" && s.productIds.length === 0
                        ? "Whole order"
                        : `${s.productIds.length} product${s.productIds.length === 1 ? "" : "s"}`}
                      {s.target_type === "specific_customers" && (
                        <span className="text-muted-foreground"> · {s.customerIds.length} cust.</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.starts_on}{s.ends_on ? ` → ${s.ends_on}` : " → open"}
                    </TableCell>
                    <TableCell className="text-right">{s.priority}</TableCell>
                    <TableCell>
                      <StatusBadge status={status === "live" ? "active" : status} label={STATUS_LABEL[status]} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Move ${selectedIds.size} scheme(s) to Inactive`}
        description="They stop applying at order entry but can be re-activated anytime."
        variant="danger"
        loading={busy}
        onConfirm={bulkDeactivate}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Move scheme to Inactive"
        description={`Move "${deleteTarget?.name}" to Inactive? It stops applying at order entry but you can re-activate it anytime. Orders that already recorded this scheme keep their prices.`}
        variant="danger"
        loading={busy}
        onConfirm={confirmDelete}
      />
    </PageLayout>
  );
}

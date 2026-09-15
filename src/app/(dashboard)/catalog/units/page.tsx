"use client";

// Catalog → Unit. Table view of units of measure, matching the other module
// tables (pinned Action column, Status filter defaulting to Active, soft-delete).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PageLayout, ConfirmDialog, BulkActionBar } from "@/components/shared";
import { Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/data-table";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";

interface UnitRow {
  id: string;
  name: string;
  short_name: string | null;
  created_at: string;
  is_active?: boolean;
}

export default function CatalogUnitsPage() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({ record_status: ["active"] });

  // Add / edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UnitRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  async function bulkDeactivate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("product_units").update({ is_active: false }).in("id", ids);
    setDeleting(false);
    if (error) toast.error("Could not update units");
    else { toast.success(`${ids.length} unit(s) moved to Inactive`); setSelectedIds(new Set()); load(); }
    setBulkOpen(false);
  }

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("product_units")
      .select("*")
      .eq("account_id", accountId)
      .order("name");
    if (error) toast.error("Could not load units");
    setUnits((data as UnitRow[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { load(); }, [load]);

  // Sidebar "+" opens the create dialog via ?new=1.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openAdd();
      router.replace("/catalog/units");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function openAdd() {
    setEditing(null);
    setName("");
    setShortName("");
    setFormOpen(true);
  }

  function openEdit(u: UnitRow) {
    setEditing(u);
    setName(u.name);
    setShortName(u.short_name ?? "");
    setFormOpen(true);
  }

  async function handleSave() {
    if (!accountId || !name.trim()) return;
    setSaving(true);
    const payload = { name: name.trim(), short_name: shortName.trim() || null };
    const { error } = editing
      ? await supabase.from("product_units").update(payload).eq("id", editing.id)
      : await supabase.from("product_units").insert({ account_id: accountId, ...payload });
    setSaving(false);
    if (error) { toast.error(`Could not ${editing ? "update" : "add"} unit`); return; }
    toast.success(editing ? "Unit updated" : "Unit added");
    setFormOpen(false);
    load();
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("product_units").update({ is_active: false }).eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) toast.error("Could not deactivate unit");
    else { toast.success("Unit moved to Inactive"); load(); }
    setDeleteTarget(null);
  }

  async function reactivate(u: UnitRow) {
    const { error } = await supabase.from("product_units").update({ is_active: true }).eq("id", u.id);
    if (error) toast.error("Could not re-activate unit");
    else { toast.success("Unit re-activated"); load(); }
  }

  const columns: ColumnDef<UnitRow>[] = [
    { id: "name", label: "Unit Name", type: "text", render: (u) => <span className="font-medium">{u.name}</span> },
    { id: "short_name", label: "Short Name", type: "text", render: (u) => <span className="text-muted-foreground">{u.short_name || "—"}</span> },
    {
      id: "created_at", label: "Created at", type: "date",
      render: (u) => <span className="text-muted-foreground text-sm">{new Date(u.created_at).toLocaleDateString()}</span>,
    },
    {
      id: "record_status", label: "Status", type: "select", visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (u) => {
        const active = u.is_active !== false;
        return (
          <Badge className={active
            ? "bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold"
            : "bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold"}>
            {active ? "Active" : "Inactive"}
          </Badge>
        );
      },
    },
    {
      id: "actions", label: "Action", visibleByDefault: true,
      render: (u) => (
        <RowActions
          disabled={!canEditSettings}
          isInactive={u.is_active === false}
          onEdit={() => openEdit(u)}
          onDelete={() => setDeleteTarget(u)}
          onReactivate={() => reactivate(u)}
          deleteTitle="Move to Inactive"
        />
      ),
    },
  ];

  const filtered = useMemo(() => {
    return units.filter((u) => {
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") { if (!u.name?.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === "short_name") { if (!(u.short_name || "").toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === "record_status") {
          const want = val as string[];
          if (Array.isArray(want) && want.length) {
            const state = u.is_active !== false ? "active" : "inactive";
            if (!want.includes(state)) return false;
          }
        }
      }
      return true;
    });
  }, [units, filterState]);

  return (
    <PageLayout>
      {canEditSettings && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          actions={[{ label: "Move to Inactive", icon: <Trash2 className="size-3.5" />, variant: "destructive", onClick: () => setBulkOpen(true) }]}
        />
      )}
      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_units_table_columns"
        isLoading={loading}
        rowKey={(u) => u.id}
        selection={canEditSettings ? {
          selectedIds,
          onSelectAll: (checked) => setSelectedIds(checked ? new Set(filtered.map((u) => u.id)) : new Set()),
          onSelect: (id, checked) => setSelectedIds((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; }),
        } : undefined}
        actions={canEditSettings ? (
          <Button size="sm" className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={openAdd}>
            <Plus className="size-3 mr-1" /> New Unit
          </Button>
        ) : undefined}
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Unit" : "New Unit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Unit Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kilograms" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Short Name</Label>
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="e.g. kg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? "Save" : "Add Unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Move unit to Inactive"
        description={<>Move <span className="font-medium text-foreground">{deleteTarget?.name}</span> to Inactive? It can be re-activated anytime.</>}
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Move ${selectedIds.size} unit(s) to Inactive`}
        description="They can be re-activated anytime."
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={bulkDeactivate}
      />
    </PageLayout>
  );
}

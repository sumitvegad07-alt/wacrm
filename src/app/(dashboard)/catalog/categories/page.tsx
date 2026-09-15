"use client";

// Catalog → Category. Table view of product categories (matching the other
// module tables: pinned Action column, Status filter defaulting to Active,
// soft-delete), plus the category-level naming config kept above the table.
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
import { PageLayout, PageHeader, ConfirmDialog, BulkActionBar } from "@/components/shared";
import { Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/data-table";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";

interface CategoryRow {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  parent_id: string | null;
  created_at: string;
  is_active?: boolean;
}

export default function CatalogCategoriesPage() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({ record_status: ["active"] });

  // Level-naming config
  const [levelsCount, setLevelsCount] = useState<1 | 2 | 3>(1);
  const [level1Name, setLevel1Name] = useState("Category");
  const [level2Name, setLevel2Name] = useState("Sub-Category");
  const [level3Name, setLevel3Name] = useState("Brand");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  // Add / edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  async function bulkDeactivate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("product_categories").update({ is_active: false }).in("id", ids);
    setDeleting(false);
    if (error) toast.error("Could not update categories");
    else { toast.success(`${ids.length} category(ies) moved to Inactive`); setSelectedIds(new Set()); load(); }
    setBulkOpen(false);
  }

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data: cats }, { data: acct }] = await Promise.all([
      supabase.from("product_categories").select("*").eq("account_id", accountId).order("created_at"),
      supabase.from("accounts").select("settings").eq("id", accountId).single(),
    ]);
    setCategories((cats as CategoryRow[]) ?? []);
    const ps = acct?.settings?.product_settings ?? {};
    setLevelsCount((ps.levels_count as 1 | 2 | 3) || 1);
    setLevel1Name(ps.level_1_name || "Category");
    setLevel2Name(ps.level_2_name || "Sub-Category");
    setLevel3Name(ps.level_3_name || "Brand");
    setSettingsDirty(false);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { load(); }, [load]);

  // Sidebar "+" opens the create dialog via ?new=1.
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openAdd();
      router.replace("/catalog/categories");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const levelName = (lvl: number) => (lvl === 3 ? level3Name : lvl === 2 ? level2Name : level1Name);
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [categories]);

  async function saveSettings() {
    if (!accountId) return;
    setSavingSettings(true);
    const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const settings = acct?.settings ?? {};
    const { error } = await supabase.from("accounts").update({
      settings: {
        ...settings,
        product_settings: {
          ...(settings.product_settings ?? {}),
          levels_count: levelsCount,
          level_1_name: level1Name,
          level_2_name: level2Name,
          level_3_name: level3Name,
        },
      },
    }).eq("id", accountId);
    setSavingSettings(false);
    if (error) { toast.error("Could not save category settings"); return; }
    toast.success("Category settings saved");
    setSettingsDirty(false);
  }

  function openAdd() {
    setEditing(null);
    setName("");
    setLevel(1);
    setParentId(null);
    setFormOpen(true);
  }

  function openEdit(c: CategoryRow) {
    setEditing(c);
    setName(c.name);
    setLevel(c.level);
    setParentId(c.parent_id);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!accountId || !name.trim()) return;
    if (level > 1 && !parentId) { toast.error("Please select a parent category"); return; }
    setSaving(true);
    const payload = { name: name.trim(), level, parent_id: level > 1 ? parentId : null };
    const { error } = editing
      ? await supabase.from("product_categories").update(payload).eq("id", editing.id)
      : await supabase.from("product_categories").insert({ account_id: accountId, ...payload });
    setSaving(false);
    if (error) { toast.error(`Could not ${editing ? "update" : "add"} category`); return; }
    toast.success(editing ? "Category updated" : "Category added");
    setFormOpen(false);
    load();
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("product_categories").update({ is_active: false }).eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) toast.error("Could not deactivate category");
    else { toast.success("Category moved to Inactive"); load(); }
    setDeleteTarget(null);
  }

  async function reactivate(c: CategoryRow) {
    const { error } = await supabase.from("product_categories").update({ is_active: true }).eq("id", c.id);
    if (error) toast.error("Could not re-activate category");
    else { toast.success("Category re-activated"); load(); }
  }

  const columns: ColumnDef<CategoryRow>[] = [
    { id: "name", label: "Category Name", type: "text", render: (c) => <span className="font-medium">{c.name}</span> },
    { id: "level", label: "Level", type: "text", render: (c) => <span className="text-muted-foreground text-sm">{levelName(c.level)}</span> },
    { id: "parent", label: "Parent", type: "text", render: (c) => <span className="text-muted-foreground text-sm">{c.parent_id ? (nameById[c.parent_id] || "—") : "—"}</span> },
    {
      id: "created_at", label: "Created at", type: "date",
      render: (c) => <span className="text-muted-foreground text-sm">{new Date(c.created_at).toLocaleDateString()}</span>,
    },
    {
      id: "record_status", label: "Status", type: "select", visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (c) => {
        const active = c.is_active !== false;
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
      render: (c) => (
        <RowActions
          disabled={!canEditSettings}
          isInactive={c.is_active === false}
          onEdit={() => openEdit(c)}
          onDelete={() => setDeleteTarget(c)}
          onReactivate={() => reactivate(c)}
          deleteTitle="Move to Inactive"
        />
      ),
    },
  ];

  const filtered = useMemo(() => {
    return categories.filter((c) => {
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") { if (!c.name?.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === "parent") { const p = c.parent_id ? (nameById[c.parent_id] || "") : ""; if (!p.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === "record_status") {
          const want = val as string[];
          if (Array.isArray(want) && want.length) {
            const state = c.is_active !== false ? "active" : "inactive";
            if (!want.includes(state)) return false;
          }
        }
      }
      return true;
    });
  }, [categories, filterState, nameById]);

  // Parent options: active categories one level up from the selected level.
  const parentOptions = categories.filter((c) => c.level === level - 1 && c.is_active !== false);

  return (
    <PageLayout>
      <PageHeader title="Categories" subtitle="Organise products into categories, with optional sub-levels." />

      {/* Level naming config */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-muted/20 p-4 rounded-lg border border-border">
        <div className="space-y-2">
          <Label>Number of Levels</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={levelsCount}
            onChange={(e) => { setLevelsCount(Number(e.target.value) as 1 | 2 | 3); setSettingsDirty(true); }}
            disabled={!canEditSettings}
          >
            <option value={1}>1 Level</option>
            <option value={2}>2 Levels</option>
            <option value={3}>3 Levels</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Level 1 Name</Label>
          <Input value={level1Name} onChange={(e) => { setLevel1Name(e.target.value); setSettingsDirty(true); }} disabled={!canEditSettings} />
        </div>
        {levelsCount >= 2 && (
          <div className="space-y-2">
            <Label>Level 2 Name</Label>
            <Input value={level2Name} onChange={(e) => { setLevel2Name(e.target.value); setSettingsDirty(true); }} disabled={!canEditSettings} />
          </div>
        )}
        {levelsCount >= 3 && (
          <div className="space-y-2">
            <Label>Level 3 Name</Label>
            <Input value={level3Name} onChange={(e) => { setLevel3Name(e.target.value); setSettingsDirty(true); }} disabled={!canEditSettings} />
          </div>
        )}
        {canEditSettings && (
          <div className="flex items-end">
            <Button size="sm" onClick={saveSettings} disabled={!settingsDirty || savingSettings}>
              {savingSettings ? <Loader2 className="size-4 mr-1 animate-spin" /> : null} Save settings
            </Button>
          </div>
        )}
      </div>

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
        storageKey="wacrm_categories_table_columns"
        isLoading={loading}
        rowKey={(c) => c.id}
        selection={canEditSettings ? {
          selectedIds,
          onSelectAll: (checked) => setSelectedIds(checked ? new Set(filtered.map((c) => c.id)) : new Set()),
          onSelect: (id, checked) => setSelectedIds((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n; }),
        } : undefined}
        actions={canEditSettings ? (
          <Button size="sm" className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={openAdd}>
            <Plus className="size-3 mr-1" /> New Category
          </Button>
        ) : undefined}
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Category Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" autoFocus />
            </div>
            {levelsCount > 1 && (
              <div className="space-y-2">
                <Label>Level</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={level}
                  onChange={(e) => { setLevel(Number(e.target.value) as 1 | 2 | 3); setParentId(null); }}
                >
                  <option value={1}>{level1Name || "Level 1"}</option>
                  {levelsCount >= 2 && <option value={2}>{level2Name || "Level 2"}</option>}
                  {levelsCount >= 3 && <option value={3}>{level3Name || "Level 3"}</option>}
                </select>
              </div>
            )}
            {level > 1 && (
              <div className="space-y-2">
                <Label>Parent ({levelName(level - 1)})</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={parentId || ""}
                  onChange={(e) => setParentId(e.target.value || null)}
                >
                  <option value="">Select parent</option>
                  {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? "Save" : "Add Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Move category to Inactive"
        description={<>Move <span className="font-medium text-foreground">{deleteTarget?.name}</span> to Inactive? It can be re-activated anytime.</>}
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Move ${selectedIds.size} category(ies) to Inactive`}
        description="They can be re-activated anytime."
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={bulkDeactivate}
      />
    </PageLayout>
  );
}

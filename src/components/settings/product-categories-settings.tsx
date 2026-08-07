"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Tag, Layers } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductCategory } from "@/types";

export interface ProductCategoriesSettingsProps {
  levelsCount: 1 | 2 | 3;
  setLevelsCount: (val: 1 | 2 | 3) => void;
  level1Name: string;
  setLevel1Name: (val: string) => void;
  level2Name: string;
  setLevel2Name: (val: string) => void;
  level3Name: string;
  setLevel3Name: (val: string) => void;
}

export function ProductCategoriesSettings({
  levelsCount,
  setLevelsCount,
  level1Name,
  setLevel1Name,
  level2Name,
  setLevel2Name,
  level3Name,
  setLevel3Name,
}: ProductCategoriesSettingsProps) {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  
  // New category state
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState<1 | 2 | 3>(1);
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data: catData, error: catError } = await supabase.from("product_categories").select("*").eq("account_id", accountId).order("created_at");

    setCategories((catData as ProductCategory[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !newName.trim()) return;
    if (newLevel > 1 && !newParentId) {
      toast.error("Please select a parent category");
      return;
    }
    
    setIsAdding(true);
    const { error } = await supabase.from("product_categories").insert({
      account_id: accountId,
      name: newName.trim(),
      level: newLevel,
      parent_id: newParentId
    });
    setIsAdding(false);
    
    if (error) {
      toast.error("Could not add category");
      return;
    }
    setNewName("");
    setNewParentId(null);
    toast.success("Category added");
    loadData();
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm("Are you sure? This will delete all sub-categories as well. Products assigned to these categories will lose their category.")) return;
    const { error } = await supabase.from("product_categories").delete().eq("id", id);
    if (error) { toast.error("Could not delete category"); return; }
    toast.success("Category deleted");
    loadData();
  }

  if (loading) {
    return <div className="p-4 text-center text-sm"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>;
  }

  const level1 = categories.filter(c => c.level === 1);
  const level2 = categories.filter(c => c.level === 2);
  const level3 = categories.filter(c => c.level === 3);

  return (
    <div className="space-y-6 pt-6 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" /> Product Categories
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Configure up to 3 levels of categorization.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-muted/20 p-4 rounded-lg border">
        <div className="space-y-2">
          <Label>Number of Levels</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={levelsCount}
            onChange={e => setLevelsCount(Number(e.target.value) as 1 | 2 | 3)}
            disabled={!canEditSettings}
          >
            <option value={1}>1 Level</option>
            <option value={2}>2 Levels</option>
            <option value={3}>3 Levels</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Level 1 Name</Label>
          <Input value={level1Name} onChange={e => setLevel1Name(e.target.value)} disabled={!canEditSettings} />
        </div>
        {levelsCount >= 2 && (
          <div className="space-y-2">
            <Label>Level 2 Name</Label>
            <Input value={level2Name} onChange={e => setLevel2Name(e.target.value)} disabled={!canEditSettings} />
          </div>
        )}
        {levelsCount >= 3 && (
          <div className="space-y-2">
            <Label>Level 3 Name</Label>
            <Input value={level3Name} onChange={e => setLevel3Name(e.target.value)} disabled={!canEditSettings} />
          </div>
        )}
      </div>

      {canEditSettings && (
        <form onSubmit={handleAddCategory} className="flex flex-wrap items-end gap-3 p-4 border rounded-lg bg-muted/30">
          <div className="grid gap-2 flex-1 min-w-[200px]">
            <Label>Add New Category</Label>
            <Input required value={newName} onChange={e => setNewName(e.target.value)} placeholder="Category Name" />
          </div>
          <div className="grid gap-2 w-32">
            <Label>Level</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={newLevel}
              onChange={e => {
                setNewLevel(Number(e.target.value) as 1 | 2 | 3);
                setNewParentId(null);
              }}
            >
              <option value={1}>{level1Name || "Level 1"}</option>
              {levelsCount >= 2 && <option value={2}>{level2Name || "Level 2"}</option>}
              {levelsCount >= 3 && <option value={3}>{level3Name || "Level 3"}</option>}
            </select>
          </div>
          {newLevel > 1 && (
            <div className="grid gap-2 flex-1 min-w-[200px]">
              <Label>Parent ({newLevel === 2 ? level1Name : level2Name})</Label>
              <select
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newParentId || ""}
                onChange={e => setNewParentId(e.target.value)}
              >
                <option value="">Select Parent</option>
                {(newLevel === 2 ? level1 : level2).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <Button type="submit" disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
          </Button>
        </form>
      )}

      {categories.length > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {level1.map(l1 => (
            <div key={l1.id} className="space-y-2">
              <div className="flex items-center justify-between p-2 border rounded-md bg-card">
                <span className="font-medium text-sm flex items-center gap-2"><Tag className="h-3 w-3 text-muted-foreground" /> {l1.name} <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{level1Name}</span></span>
                {canEditSettings && (
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(l1.id)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></Button>
                )}
              </div>
              {level2.filter(c => c.parent_id === l1.id).map(l2 => (
                <div key={l2.id} className="space-y-2 ml-6">
                  <div className="flex items-center justify-between p-2 border rounded-md bg-card">
                    <span className="font-medium text-sm flex items-center gap-2"><Tag className="h-3 w-3 text-muted-foreground" /> {l2.name} <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{level2Name}</span></span>
                    {canEditSettings && (
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(l2.id)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></Button>
                    )}
                  </div>
                  {level3.filter(c => c.parent_id === l2.id).map(l3 => (
                    <div key={l3.id} className="flex items-center justify-between p-2 border rounded-md bg-card ml-6">
                      <span className="font-medium text-sm flex items-center gap-2"><Tag className="h-3 w-3 text-muted-foreground" /> {l3.name} <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{level3Name}</span></span>
                      {canEditSettings && (
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(l3.id)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3" /></Button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

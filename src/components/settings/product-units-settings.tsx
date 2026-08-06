"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductUnit } from "@/types";

export function ProductUnitsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  
  // New unit state
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase.from("product_units").select("*").eq("account_id", accountId).order("name");
    
    if (error) { toast.error("Could not load units"); }
    setUnits((data as ProductUnit[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !newName.trim()) return;
    
    setIsAdding(true);
    const { error } = await supabase.from("product_units").insert({
      account_id: accountId,
      name: newName.trim(),
      short_name: newShortName.trim() || null,
    });
    setIsAdding(false);
    
    if (error) {
      toast.error("Could not add unit");
      return;
    }
    setNewName("");
    setNewShortName("");
    toast.success("Unit added");
    loadData();
  }

  async function handleDeleteUnit(id: string) {
    if (!confirm("Are you sure? Products using this unit will lose their unit value.")) return;
    const { error } = await supabase.from("product_units").delete().eq("id", id);
    if (error) { toast.error("Could not delete unit"); return; }
    toast.success("Unit deleted");
    loadData();
  }

  if (loading) {
    return <div className="p-4 text-center text-sm"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-6 pt-6 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4 text-muted-foreground" /> Product Units
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Manage measurement units for products (e.g., kg, pieces, boxes).
        </p>
      </div>

      {canEditSettings && (
        <form onSubmit={handleAddUnit} className="flex items-end gap-3 p-4 border rounded-lg bg-muted/30">
          <div className="grid gap-2 flex-1">
            <Label>Unit Name</Label>
            <Input required value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Kilograms" />
          </div>
          <div className="grid gap-2 w-32">
            <Label>Short Name</Label>
            <Input value={newShortName} onChange={e => setNewShortName(e.target.value)} placeholder="e.g. kg" />
          </div>
          <Button type="submit" disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
          </Button>
        </form>
      )}

      {units.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {units.map(unit => (
            <div key={unit.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
              <span className="font-medium text-sm flex items-center gap-2">
                <Scale className="h-3 w-3 text-muted-foreground" />
                {unit.name}
                {unit.short_name && <span className="text-muted-foreground font-normal">({unit.short_name})</span>}
              </span>
              {canEditSettings && (
                <Button variant="ghost" size="sm" onClick={() => handleDeleteUnit(unit.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
          No units added yet.
        </div>
      )}
    </div>
  );
}

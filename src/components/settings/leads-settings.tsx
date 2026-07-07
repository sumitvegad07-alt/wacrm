"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Tag, Building2, Globe2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPanelHead } from "./settings-panel-head";

interface LookupItem {
  id: string;
  name: string;
  color: string;
}

export function LeadsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const [statuses, setStatuses] = useState<LookupItem[]>([]);
  const [sources, setSources] = useState<LookupItem[]>([]);
  const [industries, setIndustries] = useState<LookupItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("statuses");
  
  // New Item State
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    loadData();
  }, [accountId]);

  async function loadData() {
    setLoading(true);
    const [stRes, soRes, inRes] = await Promise.all([
      supabase.from("lead_statuses").select("*").eq("account_id", accountId).order("position"),
      supabase.from("lead_sources").select("*").eq("account_id", accountId).order("position"),
      supabase.from("lead_industries").select("*").eq("account_id", accountId).order("position")
    ]);
    
    if (stRes.data) setStatuses(stRes.data);
    if (soRes.data) setSources(soRes.data);
    if (inRes.data) setIndustries(inRes.data);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !newName.trim()) return;
    setIsAdding(true);
    
    const table = `lead_${activeTab}`;
    const payload = {
      account_id: accountId,
      name: newName.trim(),
      color: newColor
    };
    
    const { error } = await supabase.from(table).insert(payload);
    setIsAdding(false);
    
    if (error) {
      toast.error(`Failed to add ${activeTab.slice(0, -1)}`);
      return;
    }
    
    toast.success(`${activeTab.slice(0, -1)} added!`);
    setNewName("");
    setNewColor("#3b82f6");
    loadData();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure? This will not delete leads but will remove this option from dropdowns.")) return;
    
    const table = `lead_${activeTab}`;
    const { error } = await supabase.from(table).delete().eq("id", id);
    
    if (error) {
      toast.error(`Failed to delete ${activeTab.slice(0, -1)}`);
      return;
    }
    toast.success("Deleted successfully");
    loadData();
  }

  function renderList(items: LookupItem[], icon: React.ReactNode, emptyMessage: string) {
    if (loading) {
      return <div className="p-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/> Loading...</div>;
    }
    if (items.length === 0) {
      return <div className="p-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed mt-4">{emptyMessage}</div>;
    }
    
    return (
      <div className="mt-4 space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="font-medium text-sm flex items-center gap-2">
                {icon} {item.name}
              </span>
            </div>
            {canEditSettings && (
              <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-500 hover:bg-red-500/10">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Lead Customizations"
        description="Manage the dropdown options available when creating or editing a lead."
      />
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="industries">Industries</TabsTrigger>
        </TabsList>
        
        {canEditSettings && (
          <form onSubmit={handleAdd} className="mt-6 flex items-end gap-4 p-4 border border-border rounded-lg bg-muted/30">
            <div className="grid gap-2 flex-1">
              <Label>New {activeTab.slice(0, -1)} name</Label>
              <Input required value={newName} onChange={e => setNewName(e.target.value)} placeholder={`e.g. ${activeTab === 'statuses' ? 'Hot Lead' : activeTab === 'sources' ? 'Facebook Ads' : 'Technology'}`} />
            </div>
            <div className="grid gap-2 w-24">
              <Label>Color</Label>
              <Input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="p-1 h-9" />
            </div>
            <Button type="submit" disabled={isAdding}>
              {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add
            </Button>
          </form>
        )}

        <TabsContent value="statuses">
          {renderList(statuses, <Tag className="h-3 w-3 text-muted-foreground" />, "No custom statuses defined. Leads will use a generic text input.")}
        </TabsContent>
        <TabsContent value="sources">
          {renderList(sources, <Globe2 className="h-3 w-3 text-muted-foreground" />, "No custom sources defined.")}
        </TabsContent>
        <TabsContent value="industries">
          {renderList(industries, <Building2 className="h-3 w-3 text-muted-foreground" />, "No custom industries defined.")}
        </TabsContent>
      </Tabs>
    </section>
  );
}

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { SettingsPanelHead } from "./settings-panel-head";

export function TasksSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState("");

  useEffect(() => {
    if (accountId) fetchSettings();
  }, [accountId]);

  const fetchSettings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .single();

    if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) && 'task_types' in data.settings && Array.isArray((data.settings as Record<string, unknown>).task_types)) {
      setTaskTypes((data.settings as Record<string, unknown>).task_types as string[]);
    } else {
      setTaskTypes(["Call", "Meeting", "WhatsApp", "Email", "Demo"]);
    }
    setLoading(false);
  };

  const saveTypes = async (types: string[]) => {
    setSaving(true);
    const { data: acc } = await supabase
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .single();

    const currentSettings = acc?.settings && typeof acc.settings === 'object' && !Array.isArray(acc.settings) ? acc.settings : {};
    const newSettings = { ...currentSettings, task_types: types };

    const { error } = await supabase
      .from("accounts")
      .update({ settings: newSettings })
      .eq("id", accountId);

    setSaving(false);
    if (error) {
      toast.error("Failed to save task types");
    } else {
      toast.success("Task types updated");
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newType.trim()) return;
    const updated = [...taskTypes, newType.trim()];
    setTaskTypes(updated);
    setNewType("");
    saveTypes(updated);
  };

  const handleDelete = (index: number) => {
    const updated = taskTypes.filter((_, i) => i !== index);
    setTaskTypes(updated);
    saveTypes(updated);
  };

  const handleUpdate = (index: number, val: string) => {
    const updated = [...taskTypes];
    updated[index] = val;
    setTaskTypes(updated);
  };

  const handleBlur = (index: number, val: string) => {
    if (!val.trim()) {
      handleDelete(index);
    } else {
      saveTypes(taskTypes);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading task settings...</div>;
  }

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Task Settings"
        description="Configure the activity types available when creating tasks and notes."
      />
      
      <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div className="space-y-3">
            {taskTypes.map((type, i) => (
              <div key={i} className="flex items-center gap-2 bg-card p-1 pr-2 border border-border rounded-md">
                <div className="p-2 text-muted-foreground/50 cursor-grab active:cursor-grabbing hover:text-foreground">
                  <GripVertical className="size-4" />
                </div>
                <Input
                  value={type}
                  onChange={(e) => handleUpdate(i, e.target.value)}
                  onBlur={(e) => handleBlur(i, e.target.value)}
                  className="h-8 border-transparent hover:border-border focus-visible:ring-1 bg-transparent"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(i)}
                  className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                  disabled={saving}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <form onSubmit={handleAdd} className="flex items-center gap-2 mt-4">
            <Input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="New task type..."
              className="flex-1"
              disabled={saving}
            />
            <Button type="submit" disabled={!newType.trim() || saving}>
              <Plus className="size-4 mr-2" /> Add
            </Button>
          </form>
          
          <p className="text-xs text-muted-foreground mt-2">
            Note: Deleting a type here won&apos;t delete existing tasks, but it will remove it from the creation dropdowns.
          </p>
        </div>

        <div className="p-5 border border-border rounded-lg bg-card space-y-4">
          <h3 className="font-semibold text-sm text-foreground">Activity Tracking &amp; CRM Workflow</h3>
          <div className="space-y-3 text-xs text-muted-foreground">
            <div className="p-3 rounded-md bg-muted/50 border border-border/50">
              <p className="font-medium text-foreground mb-1">Standardizing Team Activities</p>
              <p>When team members log activities or follow-ups with leads and customers, they select from these task types (e.g. Call, Meeting, WhatsApp, Demo).</p>
            </div>
            <div className="p-3 rounded-md bg-muted/50 border border-border/50">
              <p className="font-medium text-foreground mb-1">Activity Reporting &amp; Filters</p>
              <p>Consistent activity types enable accurate filtering in your tasks list and activity timelines across the workspace.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

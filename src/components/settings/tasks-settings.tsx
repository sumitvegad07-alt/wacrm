"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";

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

  async function fetchSettings() {
    setLoading(true);
    const { data, error } = await supabase
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .single();

    if (error) {
      console.warn("Could not load task types from settings. The migration may not be applied yet.", error);
      setTaskTypes(["Task", "Call", "Visit", "Meeting", "Follow up", "Note"]);
    } else if (data?.settings?.task_types) {
      setTaskTypes(data.settings.task_types);
    } else {
      setTaskTypes(["Task", "Call", "Visit", "Meeting", "Follow up", "Note"]);
    }
    setLoading(false);
  }

  async function saveTypes(newTypes: string[]) {
    setSaving(true);
    const { data: currentAccount } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const currentSettings = currentAccount?.settings || {};
    
    const { error } = await supabase
      .from("accounts")
      .update({ settings: { ...currentSettings, task_types: newTypes } })
      .eq("id", accountId);

    if (error) {
      toast.error("Failed to save task types");
    } else {
      setTaskTypes(newTypes);
      toast.success("Task types updated");
    }
    setSaving(false);
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newType.trim();
    if (!trimmed) return;
    if (taskTypes.map(t => t.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast.error("This type already exists");
      return;
    }
    saveTypes([...taskTypes, trimmed]);
    setNewType("");
  };

  const handleDelete = (index: number) => {
    const newTypes = [...taskTypes];
    newTypes.splice(index, 1);
    saveTypes(newTypes);
  };

  const handleUpdate = (index: number, val: string) => {
    const newTypes = [...taskTypes];
    newTypes[index] = val;
    setTaskTypes(newTypes);
  };

  const handleBlur = (index: number, val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      handleDelete(index);
    } else {
      saveTypes(taskTypes);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading task settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-lg font-medium">Task Types</h3>
        <p className="text-sm text-muted-foreground">
          Configure the activity types available when creating tasks and notes.
        </p>
      </div>

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
      
      <p className="text-xs text-muted-foreground mt-4">
        Note: Deleting a type here won't delete existing tasks, but it will remove it from the creation dropdowns.
      </p>
    </div>
  );
}

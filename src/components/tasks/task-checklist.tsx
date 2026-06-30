"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskChecklist } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TaskChecklistProps {
  taskId: string;
}

export function TaskChecklistSection({ taskId }: TaskChecklistProps) {
  const supabase = createClient();
  const [items, setItems] = useState<TaskChecklist[]>([]);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchItems();
  }, [taskId]);

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_checklists")
      .select("*")
      .eq("task_id", taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (!error && data) {
      setItems(data as TaskChecklist[]);
    }
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemTitle.trim()) return;

    setAdding(true);
    const pos = items.length;
    const { data, error } = await supabase
      .from("task_checklists")
      .insert({
        task_id: taskId,
        title: newItemTitle.trim(),
        position: pos,
      })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add item");
    } else if (data) {
      setItems([...items, data as TaskChecklist]);
      setNewItemTitle("");
    }
    setAdding(false);
  }

  async function toggleItem(id: string, currentStatus: boolean) {
    // Optimistic update
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, is_completed: !currentStatus } : it))
    );

    const { error } = await supabase
      .from("task_checklists")
      .update({ is_completed: !currentStatus })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update item");
      fetchItems(); // Revert
    }
  }

  async function deleteItem(id: string) {
    // Optimistic
    setItems((prev) => prev.filter((it) => it.id !== id));

    const { error } = await supabase
      .from("task_checklists")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete item");
      fetchItems();
    }
  }

  const completedCount = items.filter((i) => i.is_completed).length;
  const progress = items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Checklist</h3>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {progress}% ({completedCount}/{items.length})
          </span>
        )}
      </div>

      {items.length > 0 && (
        <div className="w-full bg-muted rounded-full h-2 mb-4">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading checklist...
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between gap-2 rounded-md border border-transparent p-2 hover:bg-muted/50 hover:border-border transition-colors"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <Checkbox
                  checked={item.is_completed}
                  onCheckedChange={() => toggleItem(item.id, item.is_completed)}
                />
                <span className={`text-sm truncate ${item.is_completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {item.title}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => deleteItem(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          {items.length === 0 && (
            <p className="text-sm text-muted-foreground py-2 italic">
              No items in the checklist.
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2 mt-4">
        <Input
          value={newItemTitle}
          onChange={(e) => setNewItemTitle(e.target.value)}
          placeholder="Add an item..."
          className="bg-card text-sm"
        />
        <Button type="submit" disabled={adding || !newItemTitle.trim()} size="sm">
          {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          <span className="sr-only sm:not-sr-only sm:ml-2">Add</span>
        </Button>
      </form>
    </div>
  );
}

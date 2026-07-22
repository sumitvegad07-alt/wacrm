"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ColumnDef } from "./data-table-types";

interface ManageColumnsDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnDef<T>[];
  activeColumnIds: string[];
  visibleColumnIds: string[];
  onSave: (activeIds: string[], visibleIds: string[]) => void;
}

function SortableColumnItem({ 
  id, 
  label, 
  isVisible, 
  onToggle 
}: { 
  id: string; 
  label: string; 
  isVisible: boolean; 
  onToggle: (id: string, checked: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 mb-2 rounded-md border ${
        isDragging ? "bg-muted shadow-md opacity-70" : "bg-card border-border"
      }`}
    >
      <div 
        {...attributes} 
        {...listeners} 
        className="cursor-grab hover:bg-muted/50 p-1 rounded -ml-1 text-muted-foreground"
      >
        <GripVertical className="size-4" />
      </div>
      <Checkbox
        id={`col-${id}`}
        checked={isVisible}
        onCheckedChange={(checked) => onToggle(id, checked as boolean)}
        className="size-4 rounded-[4px] accent-primary"
      />
      <label htmlFor={`col-${id}`} className="text-sm font-medium leading-none cursor-pointer flex-1">
        {label}
      </label>
    </div>
  );
}

export function ManageColumnsDialog<T>({
  open,
  onOpenChange,
  columns,
  activeColumnIds,
  visibleColumnIds,
  onSave,
}: ManageColumnsDialogProps<T>) {
  const [items, setItems] = useState<string[]>([]);
  const [visible, setVisible] = useState<Set<string>>(new Set());

  // Initialize state when dialog opens
  useEffect(() => {
    if (open) {
      setItems([...activeColumnIds]);
      setVisible(new Set(visibleColumnIds));
    }
  }, [open, activeColumnIds, visibleColumnIds]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleToggle = (id: string, checked: boolean) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSave = () => {
    onSave(items, Array.from(visible));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage columns</DialogTitle>
        </DialogHeader>
        
        <div className="py-4 max-h-[60vh] overflow-y-auto px-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items}
              strategy={verticalListSortingStrategy}
            >
              {items.map((id) => {
                const col = columns.find(c => c.id === id);
                // Skip system columns with no label (e.g. the row-actions
                // column) — they shouldn't be toggleable, and rendering
                // them produced a blank, nameless row.
                if (!col || !col.label) return null;
                return (
                  <SortableColumnItem
                    key={id}
                    id={id}
                    label={col.label}
                    isVisible={visible.has(id)}
                    onToggle={handleToggle}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

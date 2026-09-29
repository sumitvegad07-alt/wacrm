"use client";

// Reusable drag-and-drop sortable customer list (Phase 2b) — @dnd-kit.
// Used by the Route Wizard's optional sequence step and the Route Detail Customers tab.
// Sequencing is OPTIONAL: the list renders fine and is usable without ever dragging.

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortableCustomer {
  id: string; // contact_id
  primary: string;
  secondary?: string | null;
  flagged?: boolean; // e.g. needs_territory_review / outside territory
  /** Admin marked this stop as one the rep must not skip. */
  mustVisit?: boolean;
}

function Row({
  item,
  index,
  disabled,
  onRemove,
  selectable,
  selected,
  onToggleSelect,
  onToggleMustVisit,
}: {
  item: SortableCustomer;
  index: number;
  disabled?: boolean;
  onRemove?: (id: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleMustVisit?: (id: string, next: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 border-b border-border bg-card px-3 py-2 last:border-b-0",
        selected && "bg-primary/5",
        isDragging && "opacity-60 shadow-lg"
      )}
    >
      {selectable && (
        <button
          type="button"
          onClick={() => onToggleSelect?.(item.id)}
          aria-label={selected ? "Deselect" : "Select"}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </button>
      )}
      <span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      {!disabled && (
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {item.primary}
          {item.flagged && (
            <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              review
            </span>
          )}
        </p>
        {item.secondary && <p className="truncate text-xs text-muted-foreground">{item.secondary}</p>}
      </div>
      {/*
        Sits beside the sequence controls on purpose: order and "cannot be missed"
        are the two things an admin decides about a stop, and they decide them in
        the same pass. Unmarked is the resting state and shows only a faint
        outline, so a route with none marked reads exactly as it did before.
      */}
      {onToggleMustVisit && (
        <button
          type="button"
          onClick={() => onToggleMustVisit(item.id, !item.mustVisit)}
          aria-pressed={Boolean(item.mustVisit)}
          aria-label={item.mustVisit ? "Unmark as must visit" : "Mark as must visit"}
          title={item.mustVisit ? "Must visit — click to unmark" : "Mark as must visit"}
          className={cn(
            "shrink-0 rounded-md p-1 transition-colors",
            item.mustVisit
              ? "text-amber-500 hover:bg-amber-500/10"
              : "text-muted-foreground/40 hover:bg-muted hover:text-amber-500"
          )}
        >
          <Star className={cn("h-4 w-4", item.mustVisit && "fill-current")} />
        </button>
      )}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
          aria-label="Remove customer"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

export function SortableCustomerList({
  items,
  onReorder,
  disabled,
  onRemove,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleMustVisit,
}: {
  items: SortableCustomer[];
  onReorder: (orderedIds: string[]) => void;
  disabled?: boolean;
  onRemove?: (id: string) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Omit to hide the star entirely (e.g. a read-only or unauthorised view). */
  onToggleMustVisit?: (id: string, next: boolean) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex).map((i) => i.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="overflow-hidden rounded-lg border border-border">
          {items.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              index={index}
              disabled={disabled}
              onRemove={onRemove}
              selectable={selectable}
              selected={selectedIds?.has(item.id)}
              onToggleSelect={onToggleSelect}
              onToggleMustVisit={onToggleMustVisit}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

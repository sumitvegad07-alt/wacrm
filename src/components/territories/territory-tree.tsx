"use client";

import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Trash2,
  Lock,
  Dot,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TerritoryNode, TerritorySettings } from "@/lib/territories/types";
import { levelName } from "@/lib/territories/settings";

interface Props {
  roots: TerritoryNode[];
  settings: TerritorySettings;
  canEdit: boolean;
  search: string; // already trimmed/lowercased
  onAdd: (parent: TerritoryNode) => void;
  onEdit: (node: TerritoryNode) => void;
  onArchive: (node: TerritoryNode) => void;
  onRestore: (node: TerritoryNode) => void;
  onDelete: (node: TerritoryNode) => void;
}

function nodeMatches(n: TerritoryNode, q: string): boolean {
  return n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q);
}

/** Returns the subtree filtered to nodes that match or have a matching descendant,
 *  plus the set of ids that must be expanded to reveal matches. */
function filterTree(nodes: TerritoryNode[], q: string): { nodes: TerritoryNode[]; expand: Set<string> } {
  if (!q) return { nodes, expand: new Set() };
  const expand = new Set<string>();
  const walk = (list: TerritoryNode[]): TerritoryNode[] =>
    list
      .map((n) => {
        const kids = walk(n.children);
        if (nodeMatches(n, q) || kids.length > 0) {
          if (kids.length > 0) expand.add(n.id);
          return { ...n, children: kids };
        }
        return null;
      })
      .filter((n): n is TerritoryNode => n !== null);
  return { nodes: walk(nodes), expand };
}

export function TerritoryTree(props: Props) {
  const { roots, settings, canEdit, search } = props;
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());

  const { nodes, expand } = useMemo(() => filterTree(roots, search), [roots, search]);
  const maxEnabledLevel = useMemo(
    () => settings.levels.filter((l) => l.enabled).reduce((m, l) => Math.max(m, l.position), 0),
    [settings]
  );

  const isExpanded = (id: string) => (search ? expand.has(id) : manualExpanded.has(id));
  const toggle = (id: string) =>
    setManualExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No territories match your search.</p>;
  }

  return (
    <div className="space-y-0.5" role="tree">
      {nodes.map((n) => (
        <NodeRow key={n.id} node={n} depth={0} {...props} isExpanded={isExpanded} toggle={toggle} maxEnabledLevel={maxEnabledLevel} />
      ))}
    </div>
  );
}

function NodeRow({
  node,
  depth,
  settings,
  canEdit,
  maxEnabledLevel,
  isExpanded,
  toggle,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: Props & {
  node: TerritoryNode;
  depth: number;
  maxEnabledLevel: number;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = isExpanded(node.id);
  const archived = !!node.deleted_at;
  const canAddChild = canEdit && !archived && node.level < maxEnabledLevel;

  return (
    <div role="treeitem" aria-expanded={hasChildren ? open : undefined}>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md pr-2 py-1.5 hover:bg-muted/60",
          archived && "opacity-60"
        )}
        style={{ paddingLeft: depth * 20 + 4 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <Dot className="size-4 text-muted-foreground/40 shrink-0" />
        )}

        <span className={cn("text-sm font-medium truncate", archived && "line-through")}>{node.name}</span>
        {node.code && <span className="text-xs text-muted-foreground shrink-0">({node.code})</span>}

        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          {levelName(settings, node.level)}
        </Badge>
        {node.is_seed_data && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
            <Lock className="size-2.5" /> seed
          </Badge>
        )}
        {archived && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 bg-amber-500/15 text-amber-600 dark:text-amber-500">
            archived
          </Badge>
        )}

        {canEdit && (
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {canAddChild && (
              <IconBtn title="Add child" onClick={() => onAdd(node)}><Plus className="size-3.5" /></IconBtn>
            )}
            {!archived && <IconBtn title="Edit" onClick={() => onEdit(node)}><Pencil className="size-3.5" /></IconBtn>}
            {!archived ? (
              <IconBtn title="Archive" onClick={() => onArchive(node)}><Archive className="size-3.5" /></IconBtn>
            ) : (
              <IconBtn title="Restore" onClick={() => onRestore(node)}><RotateCcw className="size-3.5" /></IconBtn>
            )}
            <IconBtn title="Delete" onClick={() => onDelete(node)} danger><Trash2 className="size-3.5" /></IconBtn>
          </div>
        )}
      </div>

      {open &&
        node.children.map((c) => (
          <NodeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            settings={settings}
            canEdit={canEdit}
            search=""
            roots={[]}
            maxEnabledLevel={maxEnabledLevel}
            isExpanded={isExpanded}
            toggle={toggle}
            onAdd={onAdd}
            onEdit={onEdit}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn("h-6 w-6 p-0 text-muted-foreground hover:text-foreground", danger && "hover:text-destructive")}
    >
      {children}
    </Button>
  );
}

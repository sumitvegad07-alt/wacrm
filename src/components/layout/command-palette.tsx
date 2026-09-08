"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Shield, Settings as SettingsIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useVisibleNavItems } from "@/hooks/use-nav-items";
import { SECTION_META } from "@/components/settings/settings-sections";
import { PERMISSION_INDEX } from "@/lib/auth/permission-groups";
import { cn } from "@/lib/utils";

interface PaletteEntry {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] max-w-xl translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search the app</DialogTitle>
        {/* Rendered only while open so query/active state resets on each open. */}
        {open && <PaletteBody onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const navItems = useVisibleNavItems();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Full searchable index: screens + settings tabs + role rights.
  const entries = useMemo<PaletteEntry[]>(() => {
    const screens: PaletteEntry[] = navItems.map((n) => ({
      id: `screen:${n.href}:${n.label}`,
      label: n.label,
      sublabel: n.group ? n.group : "Screen",
      href: n.href,
      icon: n.icon,
    }));

    const settings: PaletteEntry[] = Object.values(SECTION_META).map((s) => ({
      id: `settings:${s.id}`,
      label: s.label,
      sublabel: "Settings",
      href: `/settings?tab=${s.id}`,
      icon: s.icon ?? SettingsIcon,
    }));

    const rights: PaletteEntry[] = PERMISSION_INDEX.map((p, i) => ({
      id: `right:${i}`,
      label: p.label,
      sublabel: `Rights · ${p.category}`,
      href: `/team/roles?find=${encodeURIComponent(p.label)}`,
      icon: Shield,
    }));

    return [...screens, ...settings, ...rights];
  }, [navItems]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    const scored = entries
      .map((e) => {
        const label = e.label.toLowerCase();
        const sub = e.sublabel.toLowerCase();
        let score = -1;
        const li = label.indexOf(q);
        if (li === 0) score = 0;
        else if (li > 0) score = 1;
        else if (sub.includes(q)) score = 2;
        return { e, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);
    return scored.map((x) => x.e);
  }, [entries, query]);

  // Autofocus the input on mount (DOM side-effect, not state).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  // Keep the active row scrolled into view (DOM side-effect).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onOpenChange(false);
    router.push(entry.href);
  };

  const onQueryChange = (v: string) => {
    setQuery(v);
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search screens, settings, rights…"
          className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search the app"
        />
      </div>
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No matches for “{query}”.
          </div>
        ) : (
          results.map((entry, i) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(entry)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm">{entry.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.sublabel}
                </span>
                {i === active && (
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

"use client";

// Reusable customer import picker (Phase 2b) — used by the Route Wizard and the Route
// Workspace Customers tab. "Import all" (happy path) or search + paginated multi-select.
// Business rules (eligibility, already-routed) are enforced server-side; this is pure UI.

import { useState } from "react";
import { useImportableContacts } from "@/hooks/route/use-route-refdata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE = 20;

export function CustomerImportPicker({
  accountId,
  importing,
  onImportAll,
  onImportSelected,
}: {
  accountId: string | null | undefined;
  importing: boolean;
  onImportAll: () => void;
  onImportSelected: (contactIds: string[]) => void;
}) {
  const [mode, setMode] = useState<"all" | "select">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const importable = useImportableContacts(
    mode === "select" && accountId
      ? { accountId, search: search.trim(), limit: PAGE, offset: page * PAGE }
      : null
  );
  const total = importable.data?.total ?? 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
        {(["all", "select"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {m === "all" ? "Import all (recommended)" : "Select customers"}
          </button>
        ))}
      </div>

      {mode === "all" ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Imports every customer in the assignee&apos;s territory that isn&apos;t already on a route.
          </p>
          <Button className="mt-3" onClick={onImportAll} disabled={importing}>
            {importing && <Loader2 className="h-4 w-4 animate-spin" />} Import all customers
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search customers…"
              className="pl-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            {importable.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (importable.data?.rows ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No customers found.</p>
            ) : (
              (importable.data?.rows ?? []).map((c) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                  >
                    <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.company || c.name || "Unnamed"}</span>
                    {!c.territory_id && <span className="text-[10px] text-amber-500">no territory</span>}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selected · {total} total</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button
            onClick={() => { onImportSelected([...selected]); setSelected(new Set()); }}
            disabled={selected.size === 0 || importing}
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />} Import {selected.size} selected
          </Button>
        </>
      )}
    </div>
  );
}

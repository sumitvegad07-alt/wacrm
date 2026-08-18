"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Database,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";

interface TableInfo {
  name: string;
  group: "primary" | "system" | "other";
  rowEstimate: number;
  hasAccountId: boolean;
}

interface ColumnInfo {
  name: string;
  type: string;
}

interface Filter {
  column: string;
  op: string;
  value: string;
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  like: "contains",
  is: "is",
};

const GROUP_LABELS: Record<string, string> = {
  primary: "Business data",
  other: "Other",
  system: "System & infrastructure",
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function DataBrowserPage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [redacted, setRedacted] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [draft, setDraft] = useState<Filter>({ column: "", op: "eq", value: "" });
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/db/tables");
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to load tables");
        setTables(payload.tables);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setTablesLoading(false);
      }
    })();
  }, []);

  // Tenant picker options. Read through the same audited route as everything
  // else rather than a second bespoke endpoint.
  useEffect(() => {
    (async () => {
      const res = await fetch(
        "/api/admin/db/rows?table=accounts&pageSize=200&sort=name&dir=asc",
      );
      if (!res.ok) return;
      const payload = await res.json();
      setAccounts(
        (payload.rows || []).map((r: any) => ({ id: r.id, name: r.name })),
      );
    })();
  }, []);

  const loadRows = useCallback(async () => {
    if (!selected) return;
    setRowsLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        table: selected,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (sort) {
        qs.set("sort", sort);
        qs.set("dir", dir);
      }
      if (filters.length) qs.set("filters", JSON.stringify(filters));
      if (accountId) qs.set("accountId", accountId);

      const res = await fetch(`/api/admin/db/rows?${qs}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to load rows");

      setColumns(payload.columns);
      setRedacted(payload.redactedColumns || []);
      setRows(payload.rows);
      setTotal(payload.total);
    } catch (e: any) {
      setError(e.message);
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }, [selected, page, pageSize, sort, dir, filters, accountId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const selectTable = (name: string) => {
    setSelected(name);
    setPage(1);
    setSort(null);
    setFilters([]);
    setDraft({ column: "", op: "eq", value: "" });
    setAccountId("");
  };

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? tables.filter((t) => t.name.toLowerCase().includes(q))
      : tables;

    return {
      primary: matched.filter((t) => t.group === "primary"),
      other: matched.filter((t) => t.group === "other"),
      system: matched.filter((t) => t.group === "system"),
      searching: q.length > 0,
    };
  }, [tables, search]);

  const selectedTable = tables.find((t) => t.name === selected);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const renderGroup = (key: "primary" | "other" | "system", list: TableInfo[]) => {
    if (list.length === 0) return null;
    // System tables stay collapsed unless opened or matched by a search.
    const collapsed = key === "system" && !showSystem && !grouped.searching;

    return (
      <div key={key} className="mb-3">
        <button
          onClick={() => key === "system" && setShowSystem((v) => !v)}
          className={`flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
            key === "system" ? "hover:text-foreground" : "cursor-default"
          }`}
        >
          {key === "system" &&
            (collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            ))}
          {GROUP_LABELS[key]}
          <span className="ml-auto font-normal normal-case">{list.length}</span>
        </button>

        {!collapsed && (
          <div className="mt-1 space-y-0.5">
            {list.map((t) => (
              <button
                key={t.name}
                onClick={() => selectTable(t.name)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                  selected === t.name
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="ml-auto text-xs tabular-nums opacity-60">
                  {t.rowEstimate >= 1000
                    ? `${Math.round(t.rowEstimate / 1000)}k`
                    : t.rowEstimate}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex gap-5 h-[calc(100vh-3rem)]">
      {/* Table list */}
      <aside className="w-64 shrink-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Data Browser</h2>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all tables…"
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-muted rounded-md border border-transparent focus:border-primary outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {tablesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {renderGroup("primary", grouped.primary)}
              {renderGroup("other", grouped.other)}
              {renderGroup("system", grouped.system)}
            </>
          )}
        </div>
      </aside>

      {/* Rows */}
      <section className="flex-1 min-w-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a table to browse.
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold font-mono">{selected}</h3>
                <span className="text-xs text-muted-foreground">
                  {total.toLocaleString()} rows
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">
                  Read only
                </span>

                {selectedTable?.hasAccountId && (
                  <select
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      setPage(1);
                    }}
                    className="ml-auto text-sm bg-muted rounded-md px-2 py-1 outline-none border border-transparent focus:border-primary"
                  >
                    <option value="">All tenants</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                {filters.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-md px-2 py-1"
                  >
                    <span className="font-mono">{f.column}</span>
                    <span>{OPERATOR_LABELS[f.op]}</span>
                    <span className="font-mono">{f.value}</span>
                    <button
                      onClick={() => {
                        setFilters(filters.filter((_, j) => j !== i));
                        setPage(1);
                      }}
                      className="hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}

                <select
                  value={draft.column}
                  onChange={(e) => setDraft({ ...draft, column: e.target.value })}
                  className="text-xs bg-muted rounded-md px-2 py-1 outline-none max-w-[10rem]"
                >
                  <option value="">+ filter column…</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {draft.column && (
                  <>
                    <select
                      value={draft.op}
                      onChange={(e) => setDraft({ ...draft, op: e.target.value })}
                      className="text-xs bg-muted rounded-md px-2 py-1 outline-none"
                    >
                      {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                        <option key={op} value={op}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={draft.value}
                      onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draft.value) {
                          setFilters([...filters, draft]);
                          setDraft({ column: "", op: "eq", value: "" });
                          setPage(1);
                        }
                      }}
                      placeholder="value, then Enter"
                      className="text-xs bg-muted rounded-md px-2 py-1 outline-none w-40"
                    />
                  </>
                )}
              </div>

              {redacted.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-600">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  Hidden for safety: {redacted.join(", ")}
                </p>
              )}
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-auto">
              {error ? (
                <div className="p-4 text-sm text-red-500">{error}</div>
              ) : rowsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No rows.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {columns.map((c) => (
                        <th
                          key={c.name}
                          onClick={() => {
                            if (sort === c.name) {
                              setDir(dir === "asc" ? "desc" : "asc");
                            } else {
                              setSort(c.name);
                              setDir("asc");
                            }
                            setPage(1);
                          }}
                          className="px-3 py-2 text-left font-semibold whitespace-nowrap cursor-pointer hover:text-primary"
                          title={c.type}
                        >
                          {c.name}
                          {sort === c.name && (dir === "asc" ? " ↑" : " ↓")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-t border-border hover:bg-muted/50"
                      >
                        {columns.map((c) => {
                          const text = formatCell(row[c.name]);
                          return (
                            <td
                              key={c.name}
                              className="px-3 py-1.5 font-mono whitespace-nowrap max-w-xs truncate"
                              title={text}
                            >
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pager */}
            <div className="flex items-center gap-3 p-2 border-t border-border text-xs">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 rounded-md hover:bg-muted disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded-md hover:bg-muted disabled:opacity-40"
              >
                Next
              </button>
              <span className="ml-auto text-muted-foreground">
                Every read is recorded in superadmin_audit_log
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

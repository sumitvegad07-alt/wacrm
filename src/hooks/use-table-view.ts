"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { FilterState } from "@/components/ui/data-table/data-table-types";
import {
  DEFAULT_PAGE_SIZE,
  type SavedTableView,
  type TableColumnState,
  type TableViewConfig,
  configsEqual,
  countActiveFilters,
  filtersEqual,
  normalizeTableKey,
  parseConfig,
  readActiveViewId,
  readScratchFilters,
  readStoredColumns,
  readStoredPageSize,
  writeActiveViewId,
  writeScratchFilters,
  writeStoredColumns,
  writeStoredPageSize,
} from "@/lib/table-views";

export interface TableViewApi {
  /** The DataTable storage key this instance owns. */
  storageKey: string;

  // --- what the table renders with ---
  filterState: FilterState;
  setFilter: (columnId: string, value: unknown) => void;
  setFilters: (filters: FilterState) => void;
  /** Back to the module's own defaults, and off any saved view. */
  resetFilters: () => void;
  activeFilterCount: number;
  /** True when the filters differ from the module defaults. */
  hasFilters: boolean;

  columnState: TableColumnState | null;
  setColumnState: (columns: TableColumnState) => void;
  /**
   * The layout the table is really rendering, reported by DataTable.
   *
   * `columnState` is null until the user opens Manage Columns, but a saved view
   * must still carry a column layout or re-applying it would not restore the
   * columns. DataTable knows the effective layout because only it has the column
   * definitions, so it reports it here and saving reads it.
   */
  reportEffectiveColumns: (columns: TableColumnState) => void;

  pageSize: number;
  setPageSize: (pageSize: number) => void;

  // --- saved views ---
  views: SavedTableView[];
  activeView: SavedTableView | null;
  /** The current arrangement no longer matches the view it was opened from. */
  isDirty: boolean;
  /** False once the first views fetch has settled, successfully or not. */
  viewsLoading: boolean;
  /** True when saved views are unavailable (not signed in, or the fetch failed). */
  viewsUnavailable: boolean;

  applyView: (viewId: string | null) => void;
  saveAsView: (name: string) => Promise<boolean>;
  updateActiveView: () => Promise<boolean>;
  renameView: (viewId: string, name: string) => Promise<boolean>;
  deleteView: (viewId: string) => Promise<boolean>;
  setDefaultView: (viewId: string | null) => Promise<boolean>;
}

/**
 * Owns everything a list screen remembers: its filters, its column layout, its
 * rows per page, and its saved named views.
 *
 * Two layers of memory, on purpose:
 *
 *  - Filters go to `sessionStorage`, so navigating to another screen and back —
 *    the original complaint — keeps them, and so does a refresh, while closing
 *    the browser starts clean. No network calls.
 *  - Named views go to the `table_views` table, so they follow the user to any
 *    device, and one of them can be the default the table opens with.
 *
 * Saved views are a convenience and never block the table. If the user is not
 * loaded yet, or the table is missing, or the request fails, the filter
 * remembering above still works and the Views menu simply offers "All records".
 *
 * @param storageKey  the DataTable storage key, e.g. `wacrm_leads_table_columns_v2`
 * @param defaultFilters  the module's own starting filters, e.g. `{ record_status: ['active'] }`
 */
export function useTableView(
  storageKey: string,
  defaultFilters: FilterState = {},
): TableViewApi {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile, loading: authLoading, profileLoading } = useAuth();
  const accountId = profile?.account_id ?? null;
  const userId = user?.id ?? null;

  const tableKey = useMemo(() => normalizeTableKey(storageKey), [storageKey]);

  // Module defaults are nearly always written inline at the call site
  // (`useTableView(key, { record_status: ['active'] })`), so a brand-new object
  // arrives on every render. Comparing by serialised value instead of identity
  // gives a reference that only changes when the defaults really change —
  // otherwise every effect below would re-run on every render.
  const defaultsKey = JSON.stringify(defaultFilters ?? {});
  const moduleDefaults = useMemo(
    () => JSON.parse(defaultsKey) as FilterState,
    [defaultsKey],
  );

  const [filterState, setFilterState] = useState<FilterState>(
    () => readScratchFilters(storageKey) ?? JSON.parse(defaultsKey) as FilterState,
  );
  const [columnState, setColumnStateRaw] = useState<TableColumnState | null>(() =>
    readStoredColumns(storageKey),
  );
  const [pageSize, setPageSizeRaw] = useState<number>(
    () => readStoredPageSize(storageKey) ?? DEFAULT_PAGE_SIZE,
  );

  const [views, setViews] = useState<SavedTableView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(() =>
    readActiveViewId(storageKey),
  );
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewsUnavailable, setViewsUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * A switch of storageKey means a different table: Deals keys by the selected
   * pipeline, Attendance by the open tab. Re-read everything for the new key.
   *
   * React's own idiom for "reset state when a prop changes" is to compare the
   * previous value in state rather than in a ref, so the reset happens during
   * render instead of in an effect that would paint the wrong table first.
   */
  const [renderedKey, setRenderedKey] = useState(storageKey);
  if (renderedKey !== storageKey) {
    setRenderedKey(storageKey);
    setViews([]);
    setViewsLoading(true);
    setFilterState(readScratchFilters(storageKey) ?? moduleDefaults);
    setColumnStateRaw(readStoredColumns(storageKey));
    setPageSizeRaw(readStoredPageSize(storageKey) ?? DEFAULT_PAGE_SIZE);
    setActiveViewId(readActiveViewId(storageKey));
  }

  const currentConfig = useMemo<TableViewConfig>(
    () => ({ filters: filterState, columns: columnState, pageSize }),
    [filterState, columnState, pageSize],
  );

  // ---------------------------------------------------------------- load views

  // Read inside the fetch below without making it a dependency of that effect.
  const activeViewIdRef = useRef(activeViewId);
  useEffect(() => {
    activeViewIdRef.current = activeViewId;
  }, [activeViewId]);

  /**
   * Whether this tab already had working filters for this table when the views
   * fetch started. Captured before the fetch rather than read after it, because
   * applying a view writes scratch and would otherwise erase the answer.
   */
  const hadScratchRef = useRef<boolean>(false);

  const effectiveColumnsRef = useRef<TableColumnState | null>(null);
  const reportEffectiveColumns = useCallback((columns: TableColumnState) => {
    effectiveColumnsRef.current = columns;
  }, []);

  /** What a saved view should store: the layout on screen, not "not customised". */
  const configToSave = useCallback(
    (): TableViewConfig => ({
      filters: filterState,
      columns: columnState ?? effectiveColumnsRef.current,
      pageSize,
    }),
    [filterState, columnState, pageSize],
  );

  const applyConfig = useCallback(
    (config: TableViewConfig) => {
      setFilterState(config.filters);
      writeScratchFilters(storageKey, config.filters);
      if (config.columns) {
        setColumnStateRaw(config.columns);
        writeStoredColumns(storageKey, config.columns);
      }
      if (config.pageSize) {
        setPageSizeRaw(config.pageSize);
        writeStoredPageSize(storageKey, config.pageSize);
      }
    },
    [storageKey],
  );

  useEffect(() => {
    // Wait for the session to settle rather than reporting "no views" during a
    // normal page load, but do not wait on the profile row — the fetch only
    // needs the auth id, and account_id is checked when a view is written.
    if (authLoading) return;

    if (!userId) {
      setViewsLoading(false);
      setViewsUnavailable(true);
      return;
    }

    let cancelled = false;
    hadScratchRef.current = readScratchFilters(storageKey) !== undefined;

    (async () => {
      const { data, error } = await supabase
        .from("table_views")
        .select("id, name, config, is_default")
        .eq("user_id", userId)
        .eq("table_key", tableKey)
        .order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        // Most likely the migration has not been applied yet. Filters still
        // persist locally; the Views menu just has nothing in it.
        setViews([]);
        setViewsUnavailable(true);
        setViewsLoading(false);
        return;
      }

      const parsed: SavedTableView[] = (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        is_default: Boolean(row.is_default),
        config: parseConfig(row.config),
      }));

      setViews(parsed);
      setViewsUnavailable(false);
      setViewsLoading(false);

      const stillExists = (id: string | null) => !!id && parsed.some((v) => v.id === id);

      if (stillExists(activeViewIdRef.current)) return;

      // A remembered view that has since been deleted, or none remembered.
      if (activeViewIdRef.current) {
        setActiveViewId(null);
        writeActiveViewId(storageKey, null);
      }

      // The default view opens the table, but only on a genuinely fresh visit.
      // Scratch filters mean the user is navigating inside this tab and their
      // working filters outrank the default.
      if (!hadScratchRef.current) {
        const fallback = parsed.find((v) => v.is_default);
        if (fallback) {
          setActiveViewId(fallback.id);
          writeActiveViewId(storageKey, fallback.id);
          applyConfig(fallback.config);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId, tableKey, storageKey, applyConfig, authLoading]);

  // ------------------------------------------------------------------- setters

  const commitFilters = useCallback(
    (next: FilterState) => {
      setFilterState(next);
      writeScratchFilters(storageKey, next);
    },
    [storageKey],
  );

  const setFilter = useCallback(
    (columnId: string, value: unknown) => {
      setFilterState((prev) => {
        const next = { ...prev, [columnId]: value };
        writeScratchFilters(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const setFilters = useCallback(
    (next: FilterState) => commitFilters(next),
    [commitFilters],
  );

  const resetFilters = useCallback(() => {
    commitFilters(moduleDefaults);
    setActiveViewId(null);
    writeActiveViewId(storageKey, null);
  }, [commitFilters, moduleDefaults, storageKey]);

  const setColumnState = useCallback(
    (columns: TableColumnState) => {
      setColumnStateRaw(columns);
      writeStoredColumns(storageKey, columns);
    },
    [storageKey],
  );

  const setPageSize = useCallback(
    (next: number) => {
      setPageSizeRaw(next);
      writeStoredPageSize(storageKey, next);
    },
    [storageKey],
  );

  // --------------------------------------------------------------- view actions

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  const isDirty = useMemo(
    () => (activeView ? !configsEqual(currentConfig, activeView.config) : false),
    [activeView, currentConfig],
  );

  const applyView = useCallback(
    (viewId: string | null) => {
      if (viewId === null) {
        resetFilters();
        return;
      }
      const view = views.find((v) => v.id === viewId);
      if (!view) return;
      setActiveViewId(view.id);
      writeActiveViewId(storageKey, view.id);
      applyConfig(view.config);
    },
    [views, storageKey, applyConfig, resetFilters],
  );

  const guard = useCallback((): boolean => {
    if (busy) return false;
    if (profileLoading || !userId || !accountId) {
      toast.error("Please wait for the page to finish loading, then try again.");
      return false;
    }
    if (viewsUnavailable) {
      toast.error("Saved views are not available right now.");
      return false;
    }
    return true;
  }, [busy, userId, accountId, viewsUnavailable, profileLoading]);

  const saveAsView = useCallback(
    async (rawName: string): Promise<boolean> => {
      const name = rawName.trim();
      if (!name) {
        toast.error("Give the view a name.");
        return false;
      }
      if (!guard()) return false;

      setBusy(true);
      const { data, error } = await supabase
        .from("table_views")
        .insert({
          account_id: accountId,
          user_id: userId,
          table_key: tableKey,
          name,
          config: configToSave(),
        })
        .select("id, name, config, is_default")
        .single();
      setBusy(false);

      if (error || !data) {
        toast.error(
          error?.code === "23505"
            ? `You already have a view called "${name}".`
            : "Could not save the view.",
        );
        return false;
      }

      const saved: SavedTableView = {
        id: data.id as string,
        name: data.name as string,
        is_default: Boolean(data.is_default),
        config: parseConfig(data.config),
      };
      setViews((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveViewId(saved.id);
      writeActiveViewId(storageKey, saved.id);
      toast.success(`View "${saved.name}" saved.`);
      return true;
    },
    [guard, supabase, accountId, userId, tableKey, configToSave, storageKey],
  );

  const updateActiveView = useCallback(async (): Promise<boolean> => {
    if (!activeView) return false;
    if (!guard()) return false;

    const config = configToSave();

    setBusy(true);
    const { error } = await supabase
      .from("table_views")
      .update({ config })
      .eq("id", activeView.id);
    setBusy(false);

    if (error) {
      toast.error("Could not update the view.");
      return false;
    }

    setViews((prev) => prev.map((v) => (v.id === activeView.id ? { ...v, config } : v)));
    toast.success(`View "${activeView.name}" updated.`);
    return true;
  }, [activeView, guard, supabase, configToSave]);

  const renameView = useCallback(
    async (viewId: string, rawName: string): Promise<boolean> => {
      const name = rawName.trim();
      if (!name) {
        toast.error("Give the view a name.");
        return false;
      }
      if (!guard()) return false;

      setBusy(true);
      const { error } = await supabase
        .from("table_views")
        .update({ name })
        .eq("id", viewId);
      setBusy(false);

      if (error) {
        toast.error(
          error.code === "23505"
            ? `You already have a view called "${name}".`
            : "Could not rename the view.",
        );
        return false;
      }

      setViews((prev) =>
        prev
          .map((v) => (v.id === viewId ? { ...v, name } : v))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      toast.success("View renamed.");
      return true;
    },
    [guard, supabase],
  );

  const deleteView = useCallback(
    async (viewId: string): Promise<boolean> => {
      if (!guard()) return false;

      setBusy(true);
      const { error } = await supabase.from("table_views").delete().eq("id", viewId);
      setBusy(false);

      if (error) {
        toast.error("Could not delete the view.");
        return false;
      }

      setViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) {
        setActiveViewId(null);
        writeActiveViewId(storageKey, null);
      }
      toast.success("View deleted.");
      return true;
    },
    [guard, supabase, activeViewId, storageKey],
  );

  const setDefaultView = useCallback(
    async (viewId: string | null): Promise<boolean> => {
      if (!guard()) return false;

      setBusy(true);
      // Clear the old default first: the database allows only one per table and
      // would reject the second row otherwise.
      const { error: clearError } = await supabase
        .from("table_views")
        .update({ is_default: false })
        .eq("user_id", userId)
        .eq("table_key", tableKey)
        .eq("is_default", true);

      if (clearError) {
        setBusy(false);
        toast.error("Could not change the default view.");
        return false;
      }

      if (viewId) {
        const { error } = await supabase
          .from("table_views")
          .update({ is_default: true })
          .eq("id", viewId);
        if (error) {
          setBusy(false);
          toast.error("Could not change the default view.");
          return false;
        }
      }
      setBusy(false);

      setViews((prev) => prev.map((v) => ({ ...v, is_default: v.id === viewId })));
      toast.success(
        viewId
          ? "This view will now open by default."
          : "Default view removed.",
      );
      return true;
    },
    [guard, supabase, userId, tableKey],
  );

  const activeFilterCount = countActiveFilters(filterState);
  // Compared pruned, so a text filter typed and then emptied counts as back to
  // defaults and the "clear filters" chip disappears again.
  const hasFilters = useMemo(
    () => !filtersEqual(filterState, moduleDefaults),
    [filterState, moduleDefaults],
  );

  return {
    storageKey,
    filterState,
    setFilter,
    setFilters,
    resetFilters,
    activeFilterCount,
    hasFilters,
    columnState,
    setColumnState,
    reportEffectiveColumns,
    pageSize,
    setPageSize,
    views,
    activeView,
    isDirty,
    viewsLoading,
    viewsUnavailable,
    applyView,
    saveAsView,
    updateActiveView,
    renameView,
    deleteView,
    setDefaultView,
  };
}

"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefreshOnReturn } from "@/hooks/use-refresh-on-return";

/**
 * Subscribe to Supabase Realtime `postgres_changes` for one or more tables and invoke `onChange`
 * (debounced) whenever a row is inserted/updated/deleted — e.g. when a field rep creates an order
 * or records a payment from the mobile app, the admin's list refreshes without a manual reload.
 *
 * RLS is enforced on the realtime stream, so a subscriber only receives changes to rows it can
 * SELECT (tenant isolation is automatic). `onChange` is held in a ref so a page can pass its
 * existing fetch callback without re-subscribing on every render. Mirrors the mobile hook of the
 * same name so both clients behave identically.
 *
 * Two triggers, not one: the realtime subscription, and a re-read when the tab
 * is returned to after being away (see the second effect). A subscription is
 * only as good as the publication behind it, so the screen never depends on it
 * alone.
 */
export function useRealtimeRefresh(
  tables: string | string[],
  onChange: () => void,
  options?: { enabled?: boolean; debounceMs?: number },
): void {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? 400;

  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  const key = Array.isArray(tables) ? tables.slice().sort().join(",") : tables;

  useEffect(() => {
    if (!enabled || !key) return;
    const list = key.split(",").filter(Boolean);
    if (list.length === 0) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };

    let channel = supabase.channel(`rt-${key}-${Math.random().toString(36).slice(2)}`);
    for (const t of list) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: t },
        fire,
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, key, debounceMs]);

  /**
   * The fallback: re-read the list when the tab comes back after being away.
   *
   * The subscription above is the fast path, but it is not a guarantee. A table
   * has to be on the `supabase_realtime` publication for Postgres to stream its
   * changes at all — for a long time none of the list tables were, and the
   * symptom was precisely this: a rep books an order on the phone, the admin's
   * open Orders tab shows nothing, and only a manual browser reload finds it.
   * A dropped websocket, a sleeping laptop or a DELETE that RLS cannot evaluate
   * all produce the same silence, so the screen never depends on the
   * subscription alone.
   */
  useRefreshOnReturn(() => cb.current(), enabled);
}

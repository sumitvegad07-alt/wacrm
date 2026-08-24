"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Supabase Realtime `postgres_changes` for one or more tables and invoke `onChange`
 * (debounced) whenever a row is inserted/updated/deleted — e.g. when a field rep creates an order
 * or records a payment from the mobile app, the admin's list refreshes without a manual reload.
 *
 * RLS is enforced on the realtime stream, so a subscriber only receives changes to rows it can
 * SELECT (tenant isolation is automatic). `onChange` is held in a ref so a page can pass its
 * existing fetch callback without re-subscribing on every render. Mirrors the mobile hook of the
 * same name so both clients behave identically.
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
}

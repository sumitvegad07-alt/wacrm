"use client";

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const RE_DERIVE_MS = 15_000;
const STALE_AFTER_MS = 5 * 60_000; // 5 minutes

export interface LocationPing {
  lat: number;
  lng: number;
  recorded_at: string;
}

export type LocationStatus = "active" | "stale" | "offline";

type LocationMap = Map<string, LocationPing>;

export function useLocationPresence(enabled = true) {
  const { accountId } = useAuth();
  const [rows, setRows] = useState<LocationMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active || !accountId) return;

    const supabase = createClient();
    let cancelled = false;

    // We only care about the latest ping per user
    const applyPing = (userId: string, ping: LocationPing) => {
      setRows((prev) => {
        const existing = prev.get(userId);
        if (existing && new Date(ping.recorded_at) <= new Date(existing.recorded_at)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(userId, ping);
        return next;
      });
    };

    const channel: RealtimeChannel = supabase
      .channel(`location_pings:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "location_pings",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const newPing = payload.new as {
            user_id: string;
            lat: number;
            lng: number;
            recorded_at: string;
          };
          applyPing(newPing.user_id, {
            lat: newPing.lat,
            lng: newPing.lng,
            recorded_at: newPing.recorded_at,
          });
        },
      )
      .subscribe();

    // Fetch the latest ping for all active sessions
    supabase
      .from("tracking_sessions")
      .select(`
        user_id,
        location_pings ( lat, lng, recorded_at )
      `)
      .eq("account_id", accountId)
      .is("ended_at", null)
      .order("recorded_at", { referencedTable: "location_pings", ascending: false })
      .limit(1, { referencedTable: "location_pings" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useLocationPresence] initial fetch error:", error.message);
          return;
        }
        setRows((prev) => {
          const next = new Map(prev);
          for (const session of data ?? []) {
            const pings = session.location_pings as any[];
            if (pings && pings.length > 0) {
              const ping = pings[0];
              const incoming = { lat: ping.lat, lng: ping.lng, recorded_at: ping.recorded_at };
              const existing = next.get(session.user_id as string);
              if (!existing || new Date(incoming.recorded_at) > new Date(existing.recorded_at)) {
                next.set(session.user_id as string, incoming);
              }
            }
          }
          return next;
        });
      });

    const tick = setInterval(() => setNow(Date.now()), RE_DERIVE_MS);

    return () => {
      cancelled = true;
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [active, accountId]);

  const getStatus = useCallback(
    (userId: string): LocationStatus => {
      const ping = rows.get(userId);
      if (!ping) return "offline";
      const last = new Date(ping.recorded_at).getTime();
      if (Number.isNaN(last)) return "offline";
      if (now - last > STALE_AFTER_MS) return "stale";
      return "active";
    },
    [rows, now],
  );

  const getPing = useCallback((userId: string) => rows.get(userId), [rows]);

  // Convert the internal Map to a stable array of [userId, LocationPing] so components can easily iterate
  const entries = Array.from(rows.entries());

  return { getStatus, getPing, entries, now };
}

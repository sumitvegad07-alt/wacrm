"use client";

import { useEffect, useRef, useState } from "react";
import { reverseGeocode } from "@/lib/geo-service";

/**
 * Place NAMES for a page of coordinates — "Rajkot", "Gondal", "Veraval".
 *
 * The Customer Visits table shows where a rep checked in. Latitude/longitude
 * answers that precisely and uselessly: nobody reads "22.303894, 70.802162"
 * and knows the rep was in Rajkot. This resolves the coordinate to the name of
 * the city, town or village it falls in.
 *
 * Three things keep this cheap, because Nominatim is a free service with a
 * one-request-per-second policy and this runs on every page of visits:
 *
 *  1. Coordinates are ROUNDED to three decimals (~110 m) for the lookup key.
 *     Every check-in at the same shop collapses onto one request, so a page of
 *     twenty visits to five customers costs five lookups, not twenty.
 *  2. Answers are cached in localStorage, so the second look at the table — and
 *     every other screen asking for the same places — costs nothing. A city
 *     name does not change, so the cache never expires.
 *  3. Requests are issued ONE AT A TIME through the shared throttle inside
 *     geo-service, and the component is told about each answer as it lands.
 *     The column fills in progressively instead of the page waiting.
 *
 * Deliberately not a stored column on site_visits: that would need the name
 * resolved at check-in time, on a phone that may be offline, and backfilled for
 * every visit already recorded. Resolving on read is correct for a display-only
 * value, and the cache makes it a one-off cost per location.
 */

/** ~110 m. Fine enough to distinguish two villages, coarse enough to dedupe a shop. */
const PRECISION = 3;

const STORAGE_KEY = "wacrm_place_names_v1";
/** Keep the stored map bounded; places are small strings but this is a browser. */
const MAX_STORED = 2000;

export function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(PRECISION)},${lng.toFixed(PRECISION)}`;
}

/** Process-wide, so two tables on two screens share both cache and queue. */
const memory = new Map<string, string>();
/** Keys already requested — resolved or in flight — so nothing is asked twice. */
const requested = new Set<string>();
let loadedFromStorage = false;

function loadStorage(): void {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) memory.set(key, value);
    }
  } catch {
    // A corrupt or blocked store is not a reason to break the table.
  }
}

function saveStorage(): void {
  try {
    const entries = [...memory.entries()].slice(-MAX_STORED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private mode, blocked site data, quota — all fine, the memory map still works.
  }
}

/**
 * The lookup queue. Shared so the per-second throttle is honoured across every
 * caller, and drained one at a time.
 */
const queue: { key: string; lat: number; lng: number }[] = [];
let draining = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      try {
        // zoom 10 is the city/town/village level. A street address is not what
        // this column is for, and asking for one returns more data to parse.
        const result = await reverseGeocode(next.lat, next.lng);
        const name =
          result?.city ||
          // `city` already falls back through town/village/state_district in
          // geo-service. State is the last resort rather than showing nothing.
          result?.state ||
          "";
        if (name) {
          memory.set(next.key, name);
          saveStorage();
          notify();
        } else {
          // Remember the miss for this session so the page does not retry it on
          // every render, but do not persist it — the service may answer later.
          memory.set(next.key, "");
          notify();
        }
      } catch {
        // Network failure: let a later page view try again.
        requested.delete(next.key);
      }
    }
  } finally {
    draining = false;
  }
}

export interface PlaceInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
}

/**
 * Returns a map from `placeKey(lat, lng)` to the place name, filling in as the
 * lookups land. Unknown or still-loading points are simply absent from the map,
 * so callers show their own placeholder.
 */
export function usePlaceNames(points: PlaceInput[]): Map<string, string> {
  const [, setTick] = useState(0);
  // The map identity must change when a name lands, or React skips the render.
  const snapshot = useRef(new Map<string, string>());

  // A stable description of the points asked for, so the effect runs when the
  // page of rows changes and not on every render.
  const wanted = points
    .filter((p) => p.lat != null && p.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => placeKey(Number(p.lat), Number(p.lng)));
  const wantedKey = [...new Set(wanted)].sort().join("|");

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadStorage();

    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);

    const keys = wantedKey ? wantedKey.split("|") : [];
    let queued = false;
    for (const key of keys) {
      if (memory.has(key) || requested.has(key)) continue;
      requested.add(key);
      const [lat, lng] = key.split(",").map(Number);
      queue.push({ key, lat, lng });
      queued = true;
    }
    if (queued) void drain();
    // Names already cached need a render to be picked up.
    setTick((t) => t + 1);

    return () => {
      listeners.delete(listener);
    };
  }, [wantedKey]);

  // Rebuild the returned map from the shared cache on every render. It is a
  // handful of string lookups, and a new Map identity is what tells the table
  // a name has landed.
  const next = new Map<string, string>();
  for (const key of new Set(wanted)) {
    const name = memory.get(key);
    if (name) next.set(key, name);
  }
  snapshot.current = next;
  return next;
}

/** For tests: forget everything this module has cached. */
export function resetPlaceNameCache(): void {
  memory.clear();
  requested.clear();
  queue.length = 0;
  loadedFromStorage = false;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

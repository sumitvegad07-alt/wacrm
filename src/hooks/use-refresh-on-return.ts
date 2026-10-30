"use client";

import { useEffect, useRef, useState } from "react";

/** How long away counts as "long enough that the screen is probably stale". */
const STALE_AFTER_MS = 15_000;

/**
 * Fire `onReturn` when the user comes back to the tab after being away a while.
 *
 * Why this exists: a screen that fetches once on mount is correct for exactly
 * one moment. Every dashboard tile and every list is a snapshot of the database
 * taken when the component mounted, and nothing re-reads it — so an order booked
 * on the phone, a payment entered in another tab, or an import that finished
 * while the laptop was asleep leaves the numbers on screen quietly wrong. That
 * is what "I collected the payment but the dashboard does not show it" is.
 *
 * Returning to the tab is the one moment we know the user is about to read the
 * screen again, so it is the right moment to re-read it. The threshold keeps a
 * glance at WhatsApp and back from turning into a query storm; `blur` is
 * tracked as well as `visibilitychange` because moving to another window on the
 * same screen never hides the document.
 */
export function useRefreshOnReturn(onReturn: () => void, enabled = true): void {
  const cb = useRef(onReturn);
  useEffect(() => {
    cb.current = onReturn;
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let awaySince: number | null = document.hidden ? Date.now() : null;

    const refreshIfStale = () => {
      if (document.hidden) return;
      if (awaySince !== null && Date.now() - awaySince >= STALE_AFTER_MS) {
        cb.current();
      }
      awaySince = null;
    };

    const onVisibility = () => {
      if (document.hidden) awaySince = awaySince ?? Date.now();
      else refreshIfStale();
    };
    const onBlur = () => {
      awaySince = awaySince ?? Date.now();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", refreshIfStale);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, [enabled]);
}

/**
 * The same signal as a dependency value, for a screen whose fetch lives in a
 * `useEffect` rather than in a callback it can hand over. Add the returned
 * number to that effect's dependency array and the effect re-runs — with
 * whatever auth/scope guards it already has — each time the user returns.
 */
export function useRefreshOnReturnKey(enabled = true): number {
  const [key, setKey] = useState(0);
  useRefreshOnReturn(() => setKey((k) => k + 1), enabled);
  return key;
}

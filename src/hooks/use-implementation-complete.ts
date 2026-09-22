"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./use-auth";
import { getImplementationComplete } from "@/app/(dashboard)/getting-started/actions";

/**
 * Whether this account has finished the "Getting Started" implementation.
 *
 * Used by the sidebar to hide the Getting Started link once setup is done
 * (founder decision: the entry point disappears from the main menu on
 * completion). Cached per-account in localStorage so it's instant and
 * flicker-free on subsequent loads, then refreshed once in the background.
 * Fails closed to `false` (link stays visible) on any error.
 */
export function useImplementationComplete(): boolean {
  const { accountId } = useAuth();
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const key = `impl_complete:${accountId}`;
    // Seed from the last known value so a completed account never flashes the
    // link on load. This is a legitimate on-mount sync from an external store
    // (localStorage), hence the rule suppression.
    try {
      const cached = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (cached != null) setComplete(cached === "1");
    } catch {
      /* private mode / blocked storage — fall through to the live check */
    }

    let alive = true;
    getImplementationComplete()
      .then((done) => {
        if (!alive) return;
        setComplete(done);
        try {
          localStorage.setItem(key, done ? "1" : "0");
        } catch {
          /* ignore write failures */
        }
      })
      .catch(() => {
        /* keep the cached/last value on a transient error */
      });

    return () => {
      alive = false;
    };
  }, [accountId]);

  return complete;
}

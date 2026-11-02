"use client";

import * as React from "react";
import { useRouter as useNextRouter } from "next/navigation";
import { useNavigationProgress } from "@/components/layout/navigation-progress";

/**
 * `useRouter`, with the app's navigation progress bar wired in.
 *
 * Every screen in this app imports `useRouter` from here rather than from
 * `next/navigation`, and `npm run lint:ui` fails the build when one does not. The
 * reason is in navigation-progress.tsx: a client-side navigation shows nothing at all
 * until the next route arrives, so a `router.push` on its own reads as a dead click,
 * and this app had 73 of them.
 *
 * The only difference from Next's own router is that `push`, `replace` and `back`
 * announce themselves first. Nothing else changes — same object shape, same
 * behaviour, and `prefetch` is passed straight through — so a file converts by
 * changing one import line.
 *
 * `refresh` is deliberately NOT instrumented: it re-renders the current route without
 * going anywhere, so a bar promising a new page would be a lie.
 */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  const { start } = useNavigationProgress();

  return React.useMemo(() => {
    return {
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        start();
        return router.push(...args);
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        start();
        return router.replace(...args);
      },
      back: () => {
        start();
        return router.back();
      },
      forward: () => {
        start();
        return router.forward();
      },
    };
  }, [router, start]);
}

export { useNavigationProgress } from "@/components/layout/navigation-progress";

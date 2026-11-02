"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The bar across the top of the app that says "your click landed, the next page is
 * coming".
 *
 * ## Why this exists
 *
 * A client-side navigation in the App Router is *blocking*: React keeps the page you
 * are leaving fully on screen, unchanged, until the next route's payload and JS chunk
 * have both arrived. Against a database in Mumbai that is routinely most of a second
 * and sometimes several. Nothing moves, so the control reads as dead and gets clicked
 * again — which was the complaint, twice.
 *
 * Two earlier fixes each covered one place: `loading.tsx` at the dashboard group root
 * (so the *destination* shows a spinner once it is reached) and per-control pending
 * state on the sidebar and on table rows. Both were right and neither was general. The
 * 73 `onClick={() => router.push(...)}` buttons in this app — Add Customer, Add Lead,
 * Add Employee, Edit, Back, every cross-link — had no pending state and no prefetch,
 * so they stayed dead. Worse, the next control anyone adds starts out dead too.
 *
 * This is the general answer: one bar, fed by every navigation the app starts, so a
 * control nobody remembered to instrument still tells the truth. `@/lib/navigation`'s
 * `useRouter` reports into it, and the project's `lint:ui` check fails the build if a
 * screen imports `useRouter` straight from `next/navigation` and slips out of it.
 *
 * ## How it clears
 *
 * `start()` raises a counter; arriving anywhere new drops it to zero. The counter is
 * not decremented by whoever raised it, deliberately — the component that called
 * `push` is usually unmounted by the time the navigation lands, so a paired
 * `start`/`stop` would leak a permanently visible bar. Two things clear it:
 *
 *   1. the URL changing (pathname or query), which is what "the navigation landed"
 *      actually means here; and
 *   2. a timeout, so a push that never resolves — a cancelled navigation, a redirect
 *      back to the same URL, a thrown error — cannot leave the bar stuck forever.
 */

interface NavigationProgressValue {
  /** A navigation has been asked for. Safe to call repeatedly. */
  start: () => void;
  /** True while at least one navigation is outstanding. */
  pending: boolean;
}

const Ctx = React.createContext<NavigationProgressValue | null>(null);

/**
 * How long to keep the bar up when the URL never changes.
 *
 * Long enough that a genuinely slow page still shows progress for its whole wait, short
 * enough that a navigation which quietly went nowhere does not leave a bar on screen.
 */
const STUCK_MS = 15_000;

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPending(false);
  }, []);

  const start = React.useCallback(() => {
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPending(false);
    }, STUCK_MS);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = React.useMemo<NavigationProgressValue>(() => ({ start, pending }), [start, pending]);

  return (
    <Ctx.Provider value={value}>
      {/* Suspense because useSearchParams opts the subtree into client rendering. */}
      <React.Suspense fallback={null}>
        <NavigationSettled onSettled={clear} />
      </React.Suspense>
      {children}
    </Ctx.Provider>
  );
}

/** Clears the bar when the URL actually changes — i.e. when the navigation landed. */
function NavigationSettled({ onSettled }: { onSettled: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `${pathname}?${searchParams?.toString() ?? ""}`;

  React.useEffect(() => {
    onSettled();
  }, [key, onSettled]);

  return null;
}

/**
 * Report and read navigation progress.
 *
 * Returns a no-op outside a provider, the same null-safe convention as `useConfirm`
 * and `useTableToolbarSlot`: a print route, a test, or anything rendered outside the
 * dashboard shell keeps working instead of throwing.
 */
export function useNavigationProgress(): NavigationProgressValue {
  const ctx = React.useContext(Ctx);
  return ctx ?? NOOP;
}

const NOOP: NavigationProgressValue = { start: () => {}, pending: false };

/**
 * The bar itself. Two seconds of travel to about 90%, then it waits — a progress bar
 * that cannot know the real duration should never claim to be finished, and should
 * never stall at a number that looks broken either.
 */
export function NavigationProgressBar() {
  const { pending } = useNavigationProgress();
  const [visible, setVisible] = React.useState(false);

  // Do not flash on a navigation that resolves instantly (a prefetched route, or one
  // already in the router cache). Below ~150ms a flicker is worse than nothing.
  React.useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed inset-x-0 top-0 z-tooltip h-0.5"
    >
      <div
        role="progressbar"
        aria-label="Loading the next page"
        className={
          visible
            ? "h-full bg-primary shadow-[0_0_8px_var(--color-primary)] transition-[width,opacity] duration-[2000ms] ease-out w-[90%] opacity-100"
            : "h-full bg-primary transition-opacity duration-200 w-0 opacity-0"
        }
      />
    </div>
  );
}

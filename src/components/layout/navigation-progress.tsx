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
 * again — which was the complaint, three times over.
 *
 * Earlier fixes each covered one place: `loading.tsx` at the dashboard group root (the
 * *destination* shows a spinner once it is reached) and per-control pending state on the
 * sidebar and on table rows. Both were right and neither was general. This is the
 * general answer: one bar, fed by every navigation the app starts, so a control nobody
 * remembered to instrument still tells the truth.
 *
 * Everything feeds it: `@/lib/navigation`'s `useRouter` (every `router.push` in the
 * app), `@/components/ui/link`'s `Link` (every link), and `lint:ui` fails the build if
 * a screen reaches past either of them.
 *
 * ## Why an external store and not useState
 *
 * This is the bug the third round of the complaint came from, and it is worth spelling
 * out so nobody "simplifies" it back.
 *
 * `DataTable` opens a row inside `startTransition`, which is correct — it keeps the list
 * interactive while the next page loads. But a `setState` called from inside a
 * transition callback IS a transition update: React gives it low priority and will not
 * commit it ahead of the navigation that the same transition is waiting on. So when
 * `router.push` announced itself through `useState`, the announcement arrived *with* the
 * finished navigation rather than at the start of it, and the bar never appeared for a
 * row click at all. Buttons worked, because `NavButton` pushes outside a transition.
 *
 * `useSyncExternalStore` over a plain mutable store is immune to that: a store
 * notification is not a React state update and carries no transition priority, so the
 * bar paints immediately whoever starts the navigation and however they wrap it.
 *
 * ## How it clears
 *
 * `start()` raises a flag; arriving anywhere new lowers it. It is not lowered by whoever
 * raised it, deliberately — the component that called `push` is usually unmounted by the
 * time the navigation lands, so a paired `start`/`stop` would leak a permanently visible
 * bar. Two things clear it:
 *
 *   1. the URL changing (pathname or query), which is what "the navigation landed"
 *      actually means here; and
 *   2. a timeout, so a push that never resolves — a cancelled navigation, a redirect
 *      back to the same URL, a thrown error — cannot leave the bar stuck forever.
 */

/**
 * How long to keep the bar up when the URL never changes.
 *
 * Long enough that a genuinely slow page still shows progress for its whole wait, short
 * enough that a navigation which quietly went nowhere does not leave a bar on screen.
 */
const STUCK_MS = 20_000;

/** After this long the wait stops being a flicker and deserves words, not just a bar. */
const LABEL_AFTER_MS = 700;

// ── The store ────────────────────────────────────────────────────────────────
// Module scope on purpose: there is one app-wide navigation at a time, and a module
// store is what lets `start()` be callable from anywhere, including from inside a
// transition, without being a React state update. See the note above.

type Listener = () => void;

let navigating = false;
const listeners = new Set<Listener>();
let stuckTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

/** Exported so the store can be tested without rendering a component. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Exported for the same reason as `subscribe`. */
export const getSnapshot = () => navigating;
/** The server never navigates, so it never shows the bar — and hydration matches. */
const getServerSnapshot = () => false;

/**
 * A navigation has been asked for. Safe to call repeatedly, safe to call from inside a
 * transition, and safe to call from a component that is about to unmount.
 */
export function startNavigationProgress(): void {
  if (stuckTimer) clearTimeout(stuckTimer);
  stuckTimer = setTimeout(() => {
    stuckTimer = null;
    if (!navigating) return;
    navigating = false;
    emit();
  }, STUCK_MS);

  if (navigating) return;
  navigating = true;
  emit();
}

/** The navigation landed (or was abandoned). */
export function stopNavigationProgress(): void {
  if (stuckTimer) {
    clearTimeout(stuckTimer);
    stuckTimer = null;
  }
  if (!navigating) return;
  navigating = false;
  emit();
}

// ── Hooks and components ─────────────────────────────────────────────────────

export interface NavigationProgressValue {
  start: () => void;
  stop: () => void;
  /** True while a navigation is outstanding. */
  pending: boolean;
}

/**
 * Report and read navigation progress.
 *
 * No provider needed — the store is module-level, so this works in a print route, in a
 * test, and in anything rendered outside the dashboard shell.
 */
export function useNavigationProgress(): NavigationProgressValue {
  const pending = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return React.useMemo(
    () => ({ start: startNavigationProgress, stop: stopNavigationProgress, pending }),
    [pending],
  );
}

/**
 * Kept so existing mounts keep working. It no longer owns the state — the store does —
 * but it still carries the watcher that clears the bar when the URL changes, which has
 * to live under a Suspense boundary because `useSearchParams` opts its subtree into
 * client rendering.
 */
export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <React.Suspense fallback={null}>
        <NavigationSettled />
      </React.Suspense>
      {children}
    </>
  );
}

/**
 * Clears the bar when the URL actually changes — i.e. when the navigation landed — and
 * raises it for the one navigation nothing else can see.
 *
 * Back and Forward do not go through our router or our Link: the browser moves the
 * history entry and Next renders from it. Usually that is instant off the router cache,
 * but off a cold entry it is the same silent wait as any other navigation, so `popstate`
 * feeds the bar too. The URL has already changed by the time `popstate` fires, so the
 * clear below handles it on the very next commit when the route was cached — which is
 * why the bar's own 120ms delay matters: an instant Back never flashes anything.
 */
function NavigationSettled() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `${pathname}?${searchParams?.toString() ?? ""}`;

  React.useEffect(() => {
    stopNavigationProgress();
  }, [key]);

  React.useEffect(() => {
    const onPop = () => startNavigationProgress();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return null;
}

/**
 * The bar itself, plus a word for a long wait.
 *
 * The bar travels to about 90% over two seconds and then holds: a progress bar that
 * cannot know the real duration must never claim to be finished, and must not stall at a
 * number that looks broken either. Past `LABEL_AFTER_MS` a small pill appears as well,
 * because on a genuinely slow page a 3px line is not enough to tell somebody that the
 * app is working rather than hung — which is exactly the difference between "slow" and
 * "dead".
 */
export function NavigationProgressBar() {
  const { pending } = useNavigationProgress();
  const [visible, setVisible] = React.useState(false);
  const [labelled, setLabelled] = React.useState(false);

  React.useEffect(() => {
    if (!pending) {
      setVisible(false);
      setLabelled(false);
      return;
    }
    // Do not flash on a navigation that resolves instantly (a prefetched route, or one
    // already in the router cache). Below ~120ms a flicker is worse than nothing.
    const show = setTimeout(() => setVisible(true), 120);
    const label = setTimeout(() => setLabelled(true), LABEL_AFTER_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(label);
    };
  }, [pending]);

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pointer-events-none fixed inset-x-0 top-0 z-tooltip h-[3px]"
      >
        <div
          role="progressbar"
          aria-label="Loading the next page"
          className={
            visible
              ? "h-full bg-primary shadow-[0_0_10px_var(--color-primary)] transition-[width,opacity] duration-[2000ms] ease-out w-[90%] opacity-100"
              : "h-full bg-primary transition-opacity duration-200 w-0 opacity-0"
          }
        />
      </div>

      {labelled && visible && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-3 z-tooltip -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-caption font-semibold text-foreground shadow-lg"
        >
          <span className="inline-flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            Opening…
          </span>
        </div>
      )}
    </>
  );
}

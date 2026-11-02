import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSnapshot,
  startNavigationProgress,
  stopNavigationProgress,
  subscribe,
} from "./navigation-progress";

/**
 * The store behind the navigation progress bar.
 *
 * These are not decorative. The bug that brought the dead-click complaint back a third
 * time was that the bar's state lived in `useState`, so a `start()` called from inside
 * `startTransition` — which is how `DataTable` opens a row — became a transition update
 * and was not committed until the navigation it was announcing had already finished.
 * The bar never appeared for a row click at all, which is why buttons felt fixed and
 * rows did not.
 *
 * What makes the external store immune is that a notification is delivered
 * SYNCHRONOUSLY, on the call, with no React scheduling in between. That is the property
 * worth pinning down, and the first test does exactly that.
 */

describe("navigation progress store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopNavigationProgress();
  });

  afterEach(() => {
    stopNavigationProgress();
    vi.useRealTimers();
  });

  it("notifies synchronously, so a transition cannot defer it", () => {
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });

    // Simulate what DataTable does: start the navigation from inside a transition
    // callback. By the time the callback returns the subscriber must already know —
    // that synchronous delivery is the whole reason this is not useState.
    const fakeTransition = (fn: () => void) => fn();
    fakeTransition(() => {
      startNavigationProgress();
      expect(notifications).toBe(1);
      expect(getSnapshot()).toBe(true);
    });

    unsubscribe();
  });

  it("is idempotent — pressing twice does not need two stops", () => {
    startNavigationProgress();
    startNavigationProgress();
    expect(getSnapshot()).toBe(true);
    stopNavigationProgress();
    // A single stop clears it. A counter would have left the bar up after one stop,
    // which is the leak this deliberately avoids: the component that called push is
    // usually unmounted before the navigation lands, so stops are never paired.
    expect(getSnapshot()).toBe(false);
  });

  it("does not notify again while one navigation is already running", () => {
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });
    startNavigationProgress();
    startNavigationProgress();
    startNavigationProgress();
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("clears itself when a navigation never resolves", () => {
    startNavigationProgress();
    expect(getSnapshot()).toBe(true);
    // 20s is the ceiling. A push that goes nowhere — a redirect back to the same URL, a
    // cancelled navigation, a thrown error — must not leave the bar on screen forever.
    vi.advanceTimersByTime(19_000);
    expect(getSnapshot()).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(getSnapshot()).toBe(false);
  });

  it("a later start pushes the stuck deadline back rather than inheriting the old one", () => {
    startNavigationProgress();
    vi.advanceTimersByTime(19_000);
    startNavigationProgress();      // a second navigation, 19s in
    vi.advanceTimersByTime(5_000);  // 24s since the first, 5s since this one
    expect(getSnapshot()).toBe(true);
  });

  it("a stop with nothing pending is harmless", () => {
    expect(() => stopNavigationProgress()).not.toThrow();
    expect(getSnapshot()).toBe(false);
  });

  it("an unsubscribed listener stops hearing about it", () => {
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });
    startNavigationProgress();
    expect(notifications).toBe(1);
    unsubscribe();
    stopNavigationProgress();
    startNavigationProgress();
    expect(notifications).toBe(1);
  });
});

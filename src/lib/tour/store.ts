import type { TourState } from './types';

// The tour must survive cross-page navigation (territory → settings → back), so
// it lives in sessionStorage (per-tab, cleared when the tab closes). A custom
// event lets the in-page TourRunner react immediately when a tour is launched.
const KEY = 'ozzo.tour';
const EVT = 'ozzo-tour-change';

export function readTour(): TourState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch {
    return null;
  }
}

export function writeTour(state: TourState | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* private mode / disabled storage — tour just won't persist */
  }
}

export function onTourChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

export const TOUR_EVENT = EVT;

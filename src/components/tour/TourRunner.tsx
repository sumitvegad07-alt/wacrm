'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour-theme.css';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { TOURS } from '@/lib/tour/scripts';
import { getBeat, nextBeatId } from '@/lib/tour/engine';
import { readTour, writeTour, onTourChange } from '@/lib/tour/store';
import type { Beat, TourState } from '@/lib/tour/types';
import { markStepDone } from '@/app/(dashboard)/getting-started/actions';
import { getAccountTerritorySettings } from '@/lib/territories/api';
import { enabledLevels } from '@/lib/territories/settings';

const pathOf = (page: string) => page.split('?')[0];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll for an anchor element (it may appear after a dialog opens / page renders).
async function findAnchor(selector: string, timeoutMs = 8000): Promise<HTMLElement | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return el;
    await wait(150);
  }
  return null;
}

export function TourRunner() {
  const pathname = usePathname();
  const router = useRouter();
  const { accountId } = useAuth();
  const [tour, setTour] = useState<TourState | null>(null);
  const [ask, setAsk] = useState<Extract<Beat, { kind: 'ask' }> | null>(null);
  const driverRef = useRef<Driver | null>(null);
  const processing = useRef(false);

  // Sync local state with the persisted tour.
  useEffect(() => {
    setTour(readTour());
    return onTourChange(() => setTour(readTour()));
  }, []);

  const cleanupDriver = useCallback(() => {
    try { driverRef.current?.destroy(); } catch { /* noop */ }
    driverRef.current = null;
  }, []);

  const advance = useCallback((state: TourState, beat: Beat, opts: { choice?: string; flags?: Record<string, boolean> } = {}) => {
    const script = TOURS[state.tourId];
    const nextId = nextBeatId(script, beat, opts);
    const answers = beat.kind === 'ask' && opts.choice ? { ...state.answers, [beat.answerKey]: opts.choice } : state.answers;
    if (!nextId) { writeTour(null); return; }
    writeTour({ ...state, beatId: nextId, answers });
  }, []);

  const exitTour = useCallback(() => { cleanupDriver(); setAsk(null); writeTour(null); }, [cleanupDriver]);

  // The core loop: whenever the tour, path, or account changes, render the current beat.
  useEffect(() => {
    if (!tour) { cleanupDriver(); setAsk(null); return; }
    const script = TOURS[tour.tourId];
    const beat = script ? getBeat(script, tour.beatId) : undefined;
    if (!beat) { exitTour(); return; }
    if (processing.current) return;

    let cancelled = false;
    const runClickAdvance = { current: null as null | (() => void) };

    (async () => {
      processing.current = true;
      try {
        // Non-spotlight beats first.
        if (beat.kind === 'ask') { cleanupDriver(); setAsk(beat); return; }
        setAsk(null);

        if (beat.kind === 'navigate') {
          cleanupDriver();
          if (pathOf(beat.page) !== pathname) { router.push(beat.page); return; }
          advance(tour, beat);
          return;
        }

        if (beat.kind === 'check') {
          cleanupDriver();
          let flag = false;
          if (beat.flag === 'needsMoreLevels' && accountId) {
            const desired = tour.answers.levels === 'subarea' ? 5 : tour.answers.levels === 'area' ? 4 : 3;
            try {
              const settings = await getAccountTerritorySettings(accountId);
              flag = desired > enabledLevels(settings).length;
            } catch { flag = false; }
          }
          // Area-wise accounts require a territory per customer → branch the tour to
          // spotlight the territory picker. Default true (area-wise) on read failure.
          if (beat.flag === 'areaWise' && accountId) {
            try {
              const settings = await getAccountTerritorySettings(accountId);
              flag = settings.assignment_mode !== 'direct';
            } catch { flag = true; }
          }
          if (!cancelled) advance(tour, beat, { flags: { [beat.flag]: flag } });
          return;
        }

        if (beat.kind === 'complete') {
          cleanupDriver();
          // markDone defaults true; data-driven tours (Customers) pass false so the
          // real validation — not the tour — decides when the step is complete.
          if (beat.markDone !== false) {
            try { await markStepDone(tour.stepId); } catch { /* still finish the tour */ }
          }
          writeTour(null);
          toast.success(beat.title);
          router.push('/getting-started/welcome');
          return;
        }

        // spotlight — must be on the right page and anchored to a real element.
        if (pathOf(beat.page) !== pathname) { cleanupDriver(); router.push(beat.page); return; }
        const el = await findAnchor(beat.anchor);
        if (cancelled) return;
        if (!el) {
          // Anchor never showed — let the user move on rather than get stuck.
          if (beat.optional) { advance(tour, beat); return; }
          toast.message('Continue when ready', { description: beat.text ?? beat.title });
          return;
        }

        cleanupDriver();
        const useNext = beat.advanceOn !== 'click';
        const d = driver({
          allowClose: true,
          overlayColor: 'rgba(0,0,0,0.65)',
          stagePadding: 6,
          popoverClass: 'ozzo-tour',
          onCloseClick: () => exitTour(),
        });
        driverRef.current = d;
        d.highlight({
          element: el,
          popover: {
            title: beat.title,
            description: (beat.text ?? '') + (beat.advanceOn === 'click' ? '\n\n👉 Click the highlighted button to continue.' : ''),
            showButtons: useNext ? ['next', 'close'] : ['close'],
            nextBtnText: 'Next →',
            onNextClick: () => { cleanupDriver(); advance(tour, beat); },
            onCloseClick: () => exitTour(),
          },
        });

        if (beat.advanceOn === 'click') {
          const handler = () => { cleanupDriver(); advance(tour, beat); };
          runClickAdvance.current = handler;
          el.addEventListener('click', handler, { once: true });
        }
      } finally {
        processing.current = false;
      }
    })();

    return () => {
      cancelled = true;
      if (runClickAdvance.current) {
        const el = document.querySelector((beat as { anchor?: string }).anchor ?? '');
        el?.removeEventListener('click', runClickAdvance.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- advance/cleanup are stable via useCallback; we intentionally re-run on tour/beat/path change
  }, [tour, pathname, accountId]);

  if (!ask) return null;

  // Branching question dialog (themed, not driver.js).
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">{ask.title}</h2>
        {ask.text && <p className="mt-1 text-sm text-muted-foreground">{ask.text}</p>}
        <div className="mt-4 space-y-2">
          {ask.options.map((o) => (
            <button key={o.value}
              onClick={() => { const t = readTour(); if (t) { setAsk(null); advance(t, ask, { choice: o.value }); } }}
              className="flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm transition hover:border-primary hover:bg-primary/5">
              <span>
                <span className="font-medium">{o.label}</span>
                {o.note && <span className="mt-0.5 block text-xs text-muted-foreground">{o.note}</span>}
              </span>
              {o.badge && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{o.badge}</span>}
            </button>
          ))}
        </div>
        <button onClick={exitTour} className="mt-4 text-xs text-muted-foreground underline">Exit setup guide</button>
      </div>
    </div>
  );
}

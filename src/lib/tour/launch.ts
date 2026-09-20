import { TOURS } from './scripts';
import { writeTour } from './store';

// Start a guided tour for a Getting Started step. The TourRunner (mounted in the
// dashboard shell) picks it up from sessionStorage and drives the first beat.
export function launchTour(tourId: string, stepId: string): void {
  const script = TOURS[tourId];
  if (!script || script.beats.length === 0) return;
  writeTour({ tourId, stepId, beatId: script.beats[0].id, answers: {} });
}

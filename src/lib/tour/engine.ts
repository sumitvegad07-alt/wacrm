import type { Beat, TourScript, TourFlags } from './types';

export function getBeat(script: TourScript, id: string): Beat | undefined {
  return script.beats.find((b) => b.id === id);
}

function beatAfter(script: TourScript, id: string): string | null {
  const i = script.beats.findIndex((b) => b.id === id);
  return i >= 0 && i + 1 < script.beats.length ? script.beats[i + 1].id : null;
}

// Pure branching: given the current beat and the user's inputs, what beat is next?
// - ask   → the chosen option's `goto`, else the next beat in order
// - check → ifTrue/ifFalse based on a runtime flag
// - complete → null (tour ends)
// - others → their `goto`, else the next beat in order
export function nextBeatId(
  script: TourScript,
  beat: Beat,
  opts: { choice?: string; flags?: TourFlags } = {},
): string | null {
  switch (beat.kind) {
    case 'ask': {
      const chosen = beat.options.find((o) => o.value === opts.choice);
      return chosen?.goto ?? beatAfter(script, beat.id);
    }
    case 'check':
      return opts.flags?.[beat.flag] ? beat.ifTrue : beat.ifFalse;
    case 'complete':
      return null;
    default:
      return beat.goto ?? beatAfter(script, beat.id);
  }
}

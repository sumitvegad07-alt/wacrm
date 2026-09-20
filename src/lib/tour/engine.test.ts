import { describe, it, expect } from 'vitest';
import { nextBeatId, getBeat } from './engine';
import { territoryTour } from './scripts';

const s = territoryTour;

describe('tour branching', () => {
  it('manual choice falls through to the levels question', () => {
    const beat = getBeat(s, 'method')!;
    expect(nextBeatId(s, beat, { choice: 'manual' })).toBe('levels');
  });
  it('import choice jumps to the import branch', () => {
    const beat = getBeat(s, 'method')!;
    expect(nextBeatId(s, beat, { choice: 'import' })).toBe('import_open');
  });
  it('check routes to Settings when more levels are needed', () => {
    const beat = getBeat(s, 'check_levels')!;
    expect(nextBeatId(s, beat, { flags: { needsMoreLevels: true } })).toBe('open_config_tab');
    expect(nextBeatId(s, beat, { flags: { needsMoreLevels: false } })).toBe('add_btn');
  });
  it('add-territory spotlight advances to the autofill teach', () => {
    const beat = getBeat(s, 'add_btn')!;
    expect(nextBeatId(s, beat, {})).toBe('teach_autofill');
  });
  it('autofill teach jumps to complete', () => {
    const beat = getBeat(s, 'teach_autofill')!;
    expect(nextBeatId(s, beat, {})).toBe('complete');
  });
  it('import_save jumps to complete', () => {
    expect(nextBeatId(s, getBeat(s, 'import_save')!, {})).toBe('complete');
  });
  it('complete ends the tour', () => {
    expect(nextBeatId(s, getBeat(s, 'complete')!, {})).toBeNull();
  });
});

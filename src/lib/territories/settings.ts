// Territory Master — accounts.settings.territory_settings helpers.
// Mirrors how order_settings is read/normalised. Nothing here talks to the DB;
// callers pass the raw `accounts.settings.territory_settings` value.

import type { AssignmentMode, TerritoryLevel, TerritorySettings } from './types';

export const DEFAULT_TERRITORY_LEVELS: TerritoryLevel[] = [
  { position: 1, name: 'Country', enabled: true },
  { position: 2, name: 'State', enabled: true },
  { position: 3, name: 'City', enabled: true },
  { position: 4, name: 'Area', enabled: false },
  { position: 5, name: 'Sub Area', enabled: false },
];

export const DEFAULT_TERRITORY_SETTINGS: TerritorySettings = {
  levels: DEFAULT_TERRITORY_LEVELS,
  assignment_mode: 'area_wise',
};

function isMode(v: unknown): v is AssignmentMode {
  return v === 'area_wise' || v === 'direct';
}

/** Normalise the raw jsonb into a well-formed TerritorySettings (1..5 levels). */
export function normalizeTerritorySettings(raw: unknown): TerritorySettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { levels: DEFAULT_TERRITORY_LEVELS.map((l) => ({ ...l })), assignment_mode: 'area_wise' };
  }
  const src = raw as Record<string, unknown>;
  const levelsRaw = Array.isArray(src.levels) ? src.levels : [];
  let levels: TerritoryLevel[] = levelsRaw
    .slice(0, 5)
    .map((l, i): TerritoryLevel => {
      const o = (l ?? {}) as Record<string, unknown>;
      return {
        position: typeof o.position === 'number' ? o.position : i + 1,
        name: typeof o.name === 'string' && o.name.trim() ? o.name : `Level ${i + 1}`,
        enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
      };
    });
  if (levels.length === 0) levels = DEFAULT_TERRITORY_LEVELS.map((l) => ({ ...l }));
  // Re-normalise positions to 1..n so they always match territories.level.
  levels = levels.map((l, i) => ({ ...l, position: i + 1 }));
  return {
    levels,
    assignment_mode: isMode(src.assignment_mode) ? src.assignment_mode : 'area_wise',
  };
}

/** Enabled levels, in order. */
export function enabledLevels(settings: TerritorySettings): TerritoryLevel[] {
  return settings.levels.filter((l) => l.enabled);
}

/** The deepest enabled level (the leaf a customer's territory_id points at), or null. */
export function leafLevel(settings: TerritorySettings): TerritoryLevel | null {
  const en = enabledLevels(settings);
  return en.length ? en[en.length - 1] : null;
}

/** Name of a given level position, falling back to "Level N". */
export function levelName(settings: TerritorySettings, position: number): string {
  return settings.levels.find((l) => l.position === position)?.name ?? `Level ${position}`;
}

import type { Domain, UnitType } from './types.js';

export const TICK_RATE_HZ = 12;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ;

export const DEFAULT_SERVER_PORT = 8081;

export const DOMAINS = ['land', 'water', 'air'] as const;

// Welche Domain (Begehbarkeits-Raster) fuer welchen Einheitentyp gilt -
// zentral hier statt verstreut, damit Server (Pathfinding) und Client
// (Rendering) dieselbe Zuordnung verwenden.
export const UNIT_DOMAIN: Record<UnitType, Domain> = {
  tank: 'land',
  infantry: 'land',
  boat: 'water',
  plane: 'air',
};

// Kampfwerte pro Einheitentyp (docs/KONZEPT.md Abschnitt 9, Phase 2).
// Reichweite in Kacheln, Feuerpause in Millisekunden. Startwerte fuers
// Balancing - werden nach ersten Testgefechten angepasst.
export interface CombatStats {
  maxHp: number;
  range: number;
  damage: number;
  cooldownMs: number;
}

export const COMBAT_STATS: Record<UnitType, CombatStats> = {
  tank: { maxHp: 100, range: 6, damage: 25, cooldownMs: 2000 },
  infantry: { maxHp: 60, range: 4, damage: 8, cooldownMs: 1000 },
  boat: { maxHp: 120, range: 8, damage: 30, cooldownMs: 2500 },
  plane: { maxHp: 80, range: 5, damage: 15, cooldownMs: 1500 },
};

// Schwellenwerte fuer den Hoehenwert e (-1..1) aus der Terrain-Generierung,
// siehe docs/KONZEPT.md Abschnitt 3.
export const ELEVATION_THRESHOLDS = {
  deepWaterMax: -0.2,
  shallowWaterMax: 0.0,
  beachMax: 0.02,
  plainsMax: 0.4,
  hillsMax: 0.7,
} as const;

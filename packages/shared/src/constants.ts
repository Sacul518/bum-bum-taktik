export const TICK_RATE_HZ = 12;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ;

export const DEFAULT_SERVER_PORT = 8081;

export const DOMAINS = ['land', 'water', 'air'] as const;

// Schwellenwerte fuer den Hoehenwert e (-1..1) aus der Terrain-Generierung,
// siehe docs/KONZEPT.md Abschnitt 3.
export const ELEVATION_THRESHOLDS = {
  deepWaterMax: -0.2,
  shallowWaterMax: 0.0,
  beachMax: 0.02,
  plainsMax: 0.4,
  hillsMax: 0.7,
} as const;

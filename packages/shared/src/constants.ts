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

// Sichtweite in Kacheln pro Einheitentyp - Grundlage fuer Fog of War
// (docs/KONZEPT.md Abschnitt 9, Phase 2): der Server schickt Feind-Einheiten
// nur, wenn mindestens eine Spieler-Einheit sie in Sichtweite hat. Der
// Huegel-Sichtbonus aus Abschnitt 3 kommt spaeter als Aufschlag obendrauf.
export const VISION_RANGE: Record<UnitType, number> = {
  tank: 10,
  infantry: 8,
  boat: 12,
  plane: 16,
};

// Gegner-KI: ab dieser Distanz (Kacheln) nimmt eine Feind-Einheit die
// naechste Spieler-Einheit ins Visier und verfolgt sie. Bewusst groesser als
// jede Waffen-Reichweite (sonst gaebe es keine Verfolgung) und groesser als
// die Sichtweite der Bodeneinheiten: Panzer/Infanterie koennen von Feinden
// ueberrascht werden, die sie noch nicht sehen - nur der Aufklaerer (plane,
// Sichtweite 16) entdeckt Feinde, bevor die aggro werden. Das macht
// Aufklaerung wertvoll.
export const ENEMY_AGGRO_RANGE = 14;

// Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3). Startwerte fuers
// Balancing: Der Zugriffscode (HACK_CODE_BYTES Hex-Bytes) muss innerhalb
// HACK_TIME_LIMIT_MS nachgetippt werden; Erfolg legt das Ziel HACK_STUN_MS
// lahm. HACK_RANGE bewusst groesser als jede Waffen-Reichweite (max. 8),
// damit man aus sicherer Entfernung hacken kann - aber kleiner als
// ENEMY_AGGRO_RANGE (14): wer nah genug zum Hacken ist, riskiert Aggro.
export const HACK_RANGE = 12;
export const HACK_TIME_LIMIT_MS = 12_000;
export const HACK_STUN_MS = 8_000;
export const HACK_CODE_BYTES = 4;

// Aufklaerungs-Sweep "recon" (docs/KONZEPT.md Abschnitt 6): deckt einen
// Kartenbereich voruebergehend auf (Fog of War + Feind-Sichtbarkeit), danach
// Abklingzeit fuers ganze Team. Startwerte fuers Balancing.
export const RECON_RADIUS_DEFAULT = 15;
export const RECON_RADIUS_MAX = 25;
export const RECON_DURATION_MS = 10_000;
export const RECON_COOLDOWN_MS = 60_000;

// Schwellenwerte fuer den Hoehenwert e (-1..1) aus der Terrain-Generierung,
// siehe docs/KONZEPT.md Abschnitt 3.
export const ELEVATION_THRESHOLDS = {
  deepWaterMax: -0.2,
  shallowWaterMax: 0.0,
  beachMax: 0.02,
  plainsMax: 0.4,
  hillsMax: 0.7,
} as const;

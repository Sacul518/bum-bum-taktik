import type { Domain } from '../types.js';
import { TERRAIN_TYPES, type TerrainMap, type TerrainType } from './terrain.js';

// Wer welchen Terrain-Typ befahren/betreten kann (docs/KONZEPT.md Abschnitt 3,
// Spalte "Wer kann durch?"). Bewusst nur auf Domain-Ebene (nicht pro
// Einheitentyp): die Ausnahme "Berge fuer Fahrzeuge unpassierbar, fuer
// Infanterie ok" wird hier NICHT abgebildet - dafuer braucht es spaeter eine
// einheitentyp-spezifische Bewegungskosten-Schicht oben auf diesem Raster,
// sobald Pathfinding pro Einheitentyp ansteht.
// Sand verhaelt sich wie Ebene, Schnee wie Berge. Die Bruecke ist bewusst in
// BEIDEN Rastern begehbar: Landeinheiten fahren drueber, Schiffe drunter
// durch - moeglich, weil die Raster pro Domain getrennt sind.
const LAND_WALKABLE = new Set<TerrainType>(['beach', 'plains', 'hills', 'mountains', 'sand', 'snow', 'bridge']);
const WATER_WALKABLE = new Set<TerrainType>(['deepWater', 'shallowWater', 'bridge']);

export interface WalkabilityGrids {
  width: number;
  height: number;
  /** 1 = begehbar, 0 = blockiert. Row-major, gleiche Indizierung wie TerrainMap. */
  land: Uint8Array;
  water: Uint8Array;
  air: Uint8Array;
}

export function computeWalkability(terrainMap: TerrainMap): WalkabilityGrids {
  const { width, height, terrain } = terrainMap;
  const land = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  // Luft ignoriert das Terrain-Raster groesstenteils (KONZEPT Abschnitt 3) -
  // hier vollstaendig offen, bis eine spaetere Ausbaustufe Gipfel-Sperrzonen
  // einfuehrt.
  const air = new Uint8Array(width * height).fill(1);

  for (let i = 0; i < terrain.length; i++) {
    const type = TERRAIN_TYPES[terrain[i] as number] as TerrainType;
    land[i] = LAND_WALKABLE.has(type) ? 1 : 0;
    water[i] = WATER_WALKABLE.has(type) ? 1 : 0;
  }

  return { width, height, land, water, air };
}

export function isWalkable(grids: WalkabilityGrids, domain: Domain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grids.width || y >= grids.height) return false;
  return grids[domain][y * grids.width + x] === 1;
}
